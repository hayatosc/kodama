/** Durable unsafe-call accounting and same-run failure refusal service for MCP. @module */
import * as v from 'valibot'
import type { LocalDb } from '../../agent/local-db/local.ts'
import { parseJsonValue } from '../../lib/reylo.ts'
import {
  deleteMcpCall,
  findLatestMcpCallRunId,
  findPiTaskById,
  finishMcpCallRow,
  insertMcpCall,
  listAgedMcpCalls,
  listAllMcpCalls,
  listMcpCallsByRunAndTool,
} from './calls.repository.ts'

// Pi 1.2.0 settles the tool result and this outcome in one commit, after execute returns.
const completion = v.object({
  state: v.object({
    status: v.picklist(['terminal', 'completing']),
    outcome: v.object({ status: v.literal('completed') }),
  }),
})

function committedMcpCall(db: LocalDb, callId: string): boolean {
  const task = findPiTaskById(db, Number(callId))
  if (task === undefined) return false
  return v.safeParse(completion, parseJsonValue(task.record)).success
}

/** Recovery never releases a response receipt until Pi durably committed its tool result. */
export function interruptMcpCalls(db: LocalDb, now = Date.now()) {
  for (const call of listAllMcpCalls(db)) {
    if (call.state !== 'running' && call.state !== 'succeeded') continue
    if (call.state === 'succeeded' && committedMcpCall(db, call.callId)) continue
    finishMcpCall(db, call.callId, 'mcp_outcome_unknown', now)
  }
}

/** Pi task IDs change between steps; an adopted operator entry resets refusal without an intake ledger. */
export function mcpRecoveryEpoch(db: LocalDb, operatorEntryId?: string): string {
  return operatorEntryId
    ? `operator:${operatorEntryId}`
    : (findLatestMcpCallRunId(db) ?? 'no-operator-input')
}

/** Reserve before sending; a duplicate call or a prior failed call in this operator-input epoch is refused. */
export function beginMcpCall(
  db: LocalDb,
  callId: string,
  runId: string,
  toolId: string,
  now = Date.now(),
) {
  const failed = listMcpCallsByRunAndTool(db, runId, toolId).some(
    (call) => call.state !== 'succeeded' || !committedMcpCall(db, call.callId),
  )
  if (failed) throw new Error('mcp_retry_requires_new_operator_input')
  insertMcpCall(db, { callId, runId, toolId, createdAt: now })
}

/** Success is provisional until the Pi task settles; store no remote arguments or outputs. */
export function finishMcpCall(db: LocalDb, callId: string, failure?: string, now = Date.now()) {
  finishMcpCallRow(db, {
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
  const old = listAgedMcpCalls(db, now - 7 * 86_400_000)
  for (const call of old) {
    if (
      call.runId === currentRunId &&
      (call.state !== 'succeeded' || !committedMcpCall(db, call.callId))
    )
      continue
    deleteMcpCall(db, call.callId)
  }
}
