/**
 * Data-access repository for durable MCP invocation call records and Pi task outcomes in object SQLite.
 *
 * @module
 */
import type { LocalDb } from '../../agent/local-db/local.ts'
import { queries } from './queries/index.ts'

/** Fetch the serialized Pi task record for `id`, or `undefined` when absent. */
export function findPiTaskById(db: LocalDb, id: number) {
  return queries.getPiTaskById.runSync(db.sql, { id }) ?? undefined
}

/** List all locally persisted MCP call records in the object's SQLite store. */
export function listAllMcpCalls(db: LocalDb) {
  return queries.listAllMcpCalls.runSync(db.sql)
}

/** Return the most recent MCP call run ID, if any call has been recorded. */
export function findLatestMcpCallRunId(db: LocalDb): string | undefined {
  return queries.getLatestMcpCallRunId.runSync(db.sql)?.runId ?? undefined
}

/** List MCP calls recorded within `runId` for `toolId`. */
export function listMcpCallsByRunAndTool(db: LocalDb, runId: string, toolId: string) {
  return queries.listMcpCallsByRunAndTool.runSync(db.sql, { runId, toolId })
}

/** Insert a provisional running MCP call record before dispatching transport requests. */
export function insertMcpCall(
  db: LocalDb,
  params: { callId: string; runId: string; toolId: string; createdAt: number },
): void {
  queries.insertMcpCall.runSync(db.sql, params)
}

/** Update an MCP call row with its terminal state and optional failure code. */
export function finishMcpCallRow(
  db: LocalDb,
  params: { callId: string; state: string; failure: string | null; completedAt: number },
): void {
  queries.updateFinishMcpCall.runSync(db.sql, params)
}

/** List aged MCP call records eligible for retention pruning before `before`. */
export function listAgedMcpCalls(db: LocalDb, before: number) {
  return queries.listAgedMcpCalls.runSync(db.sql, { before })
}

/** Delete a single aged MCP call receipt by ID. */
export function deleteMcpCall(db: LocalDb, callId: string): void {
  queries.deleteMcpCall.runSync(db.sql, { callId })
}
