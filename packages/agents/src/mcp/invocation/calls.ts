/** Durable unsafe-call accounting and same-run failure refusal for MCP. @module */
import * as v from 'valibot'
import { piTasks } from '../../agent/local-db/pi-tables.ts'
import { and, desc, eq, ne, lt } from 'drizzle-orm'
import { mcpCalls } from '../../../drizzle/durable-object/schema.ts'
import type { LocalDb } from '../../agent/local-db/local.ts'

// Pi 1.2.0 settles the tool result and this outcome in one commit, after execute returns.
const completion = v.object({
  state: v.object({
    status: v.picklist(['terminal', 'completing']),
    outcome: v.object({ status: v.literal('completed') }),
  }),
})

function committedMcpCall(db: LocalDb, callId: string): boolean {
  const task = db
    .select()
    .from(piTasks)
    .where(eq(piTasks.id, Number(callId)))
    .get()
  if (!task) return false
  const value: unknown = JSON.parse(task.record)
  return v.safeParse(completion, value).success
}

/** Recovery never releases a response receipt until Pi durably committed its tool result. */
export function interruptMcpCalls(db: LocalDb, now = Date.now()) {
  for (const call of db.select().from(mcpCalls).all()) {
    if (call.state !== 'running' && call.state !== 'succeeded') continue
    if (call.state === 'succeeded' && committedMcpCall(db, call.callId)) continue
    finishMcpCall(db, call.callId, 'mcp_outcome_unknown', now)
  }
}

/** Pi task IDs change between steps; an adopted operator entry resets refusal without an intake ledger. */
export function mcpRecoveryEpoch(db: LocalDb, operatorEntryId?: string): string {
  return operatorEntryId
    ? `operator:${operatorEntryId}`
    : (db.select({ runId: mcpCalls.runId }).from(mcpCalls).orderBy(desc(mcpCalls.createdAt)).get()
        ?.runId ?? 'no-operator-input')
}

/** Reserve before sending; a duplicate call or a prior failed call in this operator-input epoch is refused. */
export function beginMcpCall(
  db: LocalDb,
  callId: string,
  runId: string,
  toolId: string,
  now = Date.now(),
) {
  const failed = db
    .select()
    .from(mcpCalls)
    .where(and(eq(mcpCalls.runId, runId), eq(mcpCalls.toolId, toolId)))
    .all()
    .some((call) => call.state !== 'succeeded' || !committedMcpCall(db, call.callId))
  if (failed) throw new Error('mcp_retry_requires_new_operator_input')
  db.insert(mcpCalls).values({ callId, runId, toolId, state: 'running', createdAt: now }).run()
}

/** Success is provisional until the Pi task settles; store no remote arguments or outputs. */
export function finishMcpCall(db: LocalDb, callId: string, failure?: string, now = Date.now()) {
  db.update(mcpCalls)
    .set({
      state: failure
        ? failure === 'mcp_outcome_unknown' || failure === 'mcp_interrupted'
          ? 'outcome_unknown'
          : 'failed'
        : 'succeeded',
      failure: failure ?? null,
      completedAt: now,
    })
    .where(eq(mcpCalls.callId, callId))
    .run()
}

/** Bound terminal receipts without deleting uncertainty from the currently active run. */
export function pruneMcpCalls(db: LocalDb, currentRunId: string, now = Date.now()) {
  const old = db
    .select()
    .from(mcpCalls)
    .where(and(ne(mcpCalls.state, 'running'), lt(mcpCalls.createdAt, now - 7 * 86_400_000)))
    .all()
  for (const call of old) {
    if (
      call.runId === currentRunId &&
      (call.state !== 'succeeded' || !committedMcpCall(db, call.callId))
    )
      continue
    db.delete(mcpCalls).where(eq(mcpCalls.callId, call.callId)).run()
  }
}
