/** Durable unsafe-call accounting and same-run failure refusal for MCP. @module */
import * as v from 'valibot'
import type { LocalDb } from '../../agent/local-db/local.ts'
import { parseJsonValue } from '../../lib/reylo.ts'
import deleteMcpCall from './sql/delete-mcp-call.sql'
import finishMcpCallQuery from './sql/finish-mcp-call.sql'
import insertMcpCall from './sql/insert-mcp-call.sql'
import selectAgedMcpCalls from './sql/select-aged-mcp-calls.sql'
import selectAllMcpCalls from './sql/select-all-mcp-calls.sql'
import selectLatestMcpCallRunId from './sql/select-latest-mcp-call-run-id.sql'
import selectMcpCallsByRunAndTool from './sql/select-mcp-calls-by-run-and-tool.sql'
import selectPiTaskById from './sql/select-pi-task-by-id.sql'

// Pi 1.2.0 settles the tool result and this outcome in one commit, after execute returns.
const completion = v.object({
  state: v.object({
    status: v.picklist(['terminal', 'completing']),
    outcome: v.object({ status: v.literal('completed') }),
  }),
})

function committedMcpCall(db: LocalDb, callId: string): boolean {
  const task = selectPiTaskById.runSync(db.sql, { id: Number(callId) })
  if (task === null) return false
  return v.safeParse(completion, parseJsonValue(task.record)).success
}

/** Recovery never releases a response receipt until Pi durably committed its tool result. */
export function interruptMcpCalls(db: LocalDb, now = Date.now()) {
  for (const call of selectAllMcpCalls.runSync(db.sql)) {
    if (call.state !== 'running' && call.state !== 'succeeded') continue
    if (call.state === 'succeeded' && committedMcpCall(db, call.callId)) continue
    finishMcpCall(db, call.callId, 'mcp_outcome_unknown', now)
  }
}

/** Pi task IDs change between steps; an adopted operator entry resets refusal without an intake ledger. */
export function mcpRecoveryEpoch(db: LocalDb, operatorEntryId?: string): string {
  return operatorEntryId
    ? `operator:${operatorEntryId}`
    : (selectLatestMcpCallRunId.runSync(db.sql)?.runId ?? 'no-operator-input')
}

/** Reserve before sending; a duplicate call or a prior failed call in this operator-input epoch is refused. */
export function beginMcpCall(
  db: LocalDb,
  callId: string,
  runId: string,
  toolId: string,
  now = Date.now(),
) {
  const failed = selectMcpCallsByRunAndTool
    .runSync(db.sql, { runId, toolId })
    .some((call) => call.state !== 'succeeded' || !committedMcpCall(db, call.callId))
  if (failed) throw new Error('mcp_retry_requires_new_operator_input')
  insertMcpCall.runSync(db.sql, { callId, runId, toolId, createdAt: now })
}

/** Success is provisional until the Pi task settles; store no remote arguments or outputs. */
export function finishMcpCall(db: LocalDb, callId: string, failure?: string, now = Date.now()) {
  finishMcpCallQuery.runSync(db.sql, {
    callId,
    state: failure
      ? failure === 'mcp_outcome_unknown' || failure === 'mcp_interrupted'
        ? 'outcome_unknown'
        : 'failed'
      : 'succeeded',
    failure: failure ?? null,
    completedAt: now,
  })
}

/** Bound terminal receipts without deleting uncertainty from the currently active run. */
export function pruneMcpCalls(db: LocalDb, currentRunId: string, now = Date.now()) {
  const old = selectAgedMcpCalls.runSync(db.sql, { before: now - 7 * 86_400_000 })
  for (const call of old) {
    if (
      call.runId === currentRunId &&
      (call.state !== 'succeeded' || !committedMcpCall(db, call.callId))
    )
      continue
    deleteMcpCall.runSync(db.sql, { callId: call.callId })
  }
}
