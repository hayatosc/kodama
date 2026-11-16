/**
 * Durable persistence for deferred tool-call approvals (`kodama_deferred_calls`), enabling
 * non-blocking operator sign-off without holding an active turn open.
 *
 * @see docs/agents.md — Tool approvals
 * @module
 */
import { parseEnum } from '../../lib/reylo.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import type { LocalDb } from './local.ts'
import consumeDeferredCall from './sql/consume-deferred-call.sql'
import decideDeferredCallQuery from './sql/decide-deferred-call.sql'
import expireDeferredCallsByIds from './sql/expire-deferred-calls-by-ids.sql'
import expireDeferredCallsQuery from './sql/expire-deferred-calls.sql'
import insertDeferredCall from './sql/insert-deferred-call.sql'
import listDeferredCallsQuery from './sql/list-deferred-calls.sql'
import selectApprovedCallNullDigest from './sql/select-approved-call-null-digest.sql'
import selectApprovedCallWithDigest from './sql/select-approved-call-with-digest.sql'
import selectDeferredCallById from './sql/select-deferred-call-by-id.sql'
import selectDeferredCallBySourceTask from './sql/select-deferred-call-by-source-task.sql'
import selectMcpDeferredCandidates from './sql/select-mcp-deferred-candidates.sql'
import selectPendingDeferredCalls from './sql/select-pending-deferred-calls.sql'

/** Default expiration window (24 hours) for an unanswered tool approval request. */
export const DEFERRED_CALL_TTL_MS = 24 * 60 * 60 * 1000

const MCP_MODEL_NAME = /^mcp_[a-f0-9]{20}_[a-f0-9]{20}$/u

const DEFERRED_CALL_STATES = ['pending', 'approved', 'denied', 'consumed', 'expired'] as const

/** Permitted lifecycle state of a deferred tool call approval. */
export type DeferredCallState = (typeof DEFERRED_CALL_STATES)[number]

/** A deferred tool call row. */
export interface DeferredCallRow {
  approvalId: string
  toolName: string
  toolDigest: string | null
  argumentsJson: string
  reason: string
  sourceTask: string
  state: DeferredCallState
  operatorNote: string | null
  createdAt: number
  expiresAt: number
  decidedAt: number | null
}

function parseDeferredCallRow(row: {
  approvalId: string
  toolName: string
  toolDigest: string | null
  argumentsJson: string
  reason: string
  sourceTask: string
  state: string
  operatorNote: string | null
  createdAt: number
  expiresAt: number
  decidedAt: number | null
}): DeferredCallRow {
  return {
    ...row,
    state: parseEnum(DEFERRED_CALL_STATES, row.state, 'deferred call state'),
  }
}

/** Mark expired pending approvals so they cannot be accidentally approved or executed later. */
export function expireDeferredCalls(db: LocalDb, now: number): number {
  return expireDeferredCallsQuery.runSync(db.sql, { decidedAt: now, expiresBefore: now }).length
}

/**
 * Expire pending or approved MCP deferred calls whose tool selection was removed or whose
 * definition digest changed.
 */
export function invalidateMcpDeferredCalls(
  db: LocalDb,
  activeDigests: ReadonlyMap<string, string>,
  now: number,
): number {
  return db.transactionSync(() => {
    const candidates = selectMcpDeferredCandidates.runSync(db.sql)
    const staleIds = candidates
      .filter((row) => {
        // Legacy MCP rows without a digest use mcp_<20hex>_<20hex>; native mcp_* tools do not.
        if (row.toolDigest === null && !MCP_MODEL_NAME.test(row.toolName)) return false
        const activeDigest = activeDigests.get(row.toolName)
        return activeDigest === undefined || activeDigest !== row.toolDigest
      })
      .map((row) => row.approvalId)
    if (staleIds.length === 0) return 0
    return expireDeferredCallsByIds.runSync(db.sql, {
      decidedAt: now,
      idsJson: JSON.stringify(staleIds),
    }).length
  })
}

/**
 * Persist a pending deferred tool call atomically; idempotent on `sourceTask` so tool replay
 * returns the same `approvalId`.
 */
export function createDeferredCall(
  db: LocalDb,
  input: {
    toolName: string
    toolDigest?: string | null
    argumentsJson: string
    reason: string
    sourceTask: string
  },
  now: number,
): DeferredCallRow {
  return db.transactionSync(() => {
    const existing = selectDeferredCallBySourceTask.runSync(db.sql, {
      sourceTask: input.sourceTask,
    })
    if (existing !== null) return parseDeferredCallRow(existing)
    return parseDeferredCallRow(
      insertDeferredCall.runSync(db.sql, {
        approvalId: uuidv7(),
        toolName: input.toolName,
        toolDigest: input.toolDigest ?? null,
        argumentsJson: input.argumentsJson,
        reason: input.reason,
        sourceTask: input.sourceTask,
        createdAt: now,
        expiresAt: now + DEFERRED_CALL_TTL_MS,
      }),
    )
  })
}

/** Fetch a deferred call by its `approvalId`, expiring stale rows first. */
export function getDeferredCall(
  db: LocalDb,
  approvalId: string,
  now: number,
): DeferredCallRow | undefined {
  expireDeferredCalls(db, now)
  const row = selectDeferredCallById.runSync(db.sql, { approvalId })
  return row === null ? undefined : parseDeferredCallRow(row)
}

/**
 * Consume an approved deferred call matching `(toolName, toolDigest, argumentsJson)` atomically so
 * one approval authorizes exactly one execution against the reviewed tool definition.
 */
export function consumeApprovedCall(
  db: LocalDb,
  toolName: string,
  argumentsJson: string,
  now: number,
  toolDigest: string | null = null,
): DeferredCallRow | undefined {
  return db.transactionSync(() => {
    const match =
      toolDigest !== null
        ? selectApprovedCallWithDigest.runSync(db.sql, {
            toolName,
            toolDigest,
            argumentsJson,
            now,
          })
        : selectApprovedCallNullDigest.runSync(db.sql, {
            toolName,
            argumentsJson,
            now,
          })
    if (match === null) return undefined
    const updated = consumeDeferredCall.runSync(db.sql, { approvalId: match.approvalId })
    return updated === null ? undefined : parseDeferredCallRow(updated)
  })
}

/** Record an operator decision inside an existing SQLite transaction. */
export function decideDeferredCallInTx(
  tx: LocalDb,
  approvalId: string,
  decision: 'approve' | 'deny',
  note: string | undefined,
  now: number,
): { row: DeferredCallRow; alreadyDecided: boolean } {
  expireDeferredCalls(tx, now)
  const raw = selectDeferredCallById.runSync(tx.sql, { approvalId })
  if (raw === null) throw new Error('approval_not_found')
  const row = parseDeferredCallRow(raw)
  const targetState = decision === 'approve' ? 'approved' : 'denied'
  if (row.state === targetState || (row.state === 'consumed' && decision === 'approve')) {
    return { row, alreadyDecided: true }
  }
  if (row.state !== 'pending') {
    throw new Error(`approval_not_pending:${row.state}`)
  }
  const updated = decideDeferredCallQuery.runSync(tx.sql, {
    state: targetState,
    operatorNote: note ?? null,
    decidedAt: now,
    approvalId,
  })
  if (updated === null) throw new Error('approval_not_pending')
  return { row: parseDeferredCallRow(updated), alreadyDecided: false }
}

/** Record an operator decision (`approve` or `deny`) on a pending deferred call. */
export function decideDeferredCall(
  db: LocalDb,
  approvalId: string,
  decision: 'approve' | 'deny',
  note: string | undefined,
  now: number,
): { row: DeferredCallRow; alreadyDecided: boolean } {
  return db.transactionSync(() => decideDeferredCallInTx(db, approvalId, decision, note, now))
}

/** Pending non-expired deferred calls for `attention()` projection, oldest first. */
export function pendingDeferredCalls(db: LocalDb, now: number): DeferredCallRow[] {
  expireDeferredCalls(db, now)
  return selectPendingDeferredCalls.runSync(db.sql, { now }).map(parseDeferredCallRow)
}

/** Recent deferred calls (newest first) for inspection via RPC. */
export function listDeferredCalls(db: LocalDb, now: number, limit = 50): DeferredCallRow[] {
  expireDeferredCalls(db, now)
  return listDeferredCallsQuery.runSync(db.sql, { limit }).map(parseDeferredCallRow)
}
