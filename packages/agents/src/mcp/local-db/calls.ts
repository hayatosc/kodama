/** Durable unsafe-call accounting and same-run failure refusal for MCP. @module */
import { and, desc, eq, ne, lt, or } from 'drizzle-orm'
import { mcpCalls } from '../../../drizzle/durable-object/schema.ts'
import type { LocalDb } from '../../agent/local-db/local.ts'

/** Recovery never replays a remote call whose response was not committed. */
export function interruptMcpCalls(db: LocalDb, now = Date.now()) {
  db.update(mcpCalls)
    .set({ state: 'outcome_unknown', failure: 'mcp_outcome_unknown', completedAt: now })
    .where(eq(mcpCalls.state, 'running'))
    .run()
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
    .where(
      and(eq(mcpCalls.runId, runId), eq(mcpCalls.toolId, toolId), ne(mcpCalls.state, 'succeeded')),
    )
    .get()
  if (failed) throw new Error('mcp_retry_requires_new_operator_input')
  db.insert(mcpCalls).values({ callId, runId, toolId, state: 'running', createdAt: now }).run()
}

/** Store only a local failure code, never arguments, outputs, session IDs or remote diagnostics. */
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
  db.delete(mcpCalls)
    .where(
      and(
        or(ne(mcpCalls.runId, currentRunId), eq(mcpCalls.state, 'succeeded')),
        ne(mcpCalls.state, 'running'),
        lt(mcpCalls.createdAt, now - 7 * 86_400_000),
      ),
    )
    .run()
}
