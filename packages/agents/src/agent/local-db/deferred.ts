/**
 * Durable persistence for deferred tool-call approvals (`kodama_deferred_calls`), enabling
 * non-blocking operator sign-off without holding an active turn open.
 *
 * @see docs/agents.md — Tool approvals
 * @module
 */
import { and, asc, desc, eq, gt, lte } from 'drizzle-orm'
import { deferredCalls } from '../../../drizzle/durable-object/schema.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import type { LocalDb } from './local.ts'

/** Default expiration window (24 hours) for an unanswered tool approval request. */
export const DEFERRED_CALL_TTL_MS = 24 * 60 * 60 * 1000

/** A deferred tool call row. */
export type DeferredCallRow = typeof deferredCalls.$inferSelect

/** Mark expired pending approvals so they cannot be accidentally approved or executed later. */
export function expireDeferredCalls(db: LocalDb, now: number): number {
  const expired = db
    .update(deferredCalls)
    .set({ state: 'expired', decidedAt: now })
    .where(and(eq(deferredCalls.state, 'pending'), lte(deferredCalls.expiresAt, now)))
    .returning({ approvalId: deferredCalls.approvalId })
    .all()
  return expired.length
}

/**
 * Persist a pending deferred tool call atomically; idempotent on `sourceTask` so tool replay
 * returns the same `approvalId`.
 */
export function createDeferredCall(
  db: LocalDb,
  input: {
    toolName: string
    argumentsJson: string
    reason: string
    sourceTask: string
  },
  now: number,
): DeferredCallRow {
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(deferredCalls)
      .where(eq(deferredCalls.sourceTask, input.sourceTask))
      .get()
    if (existing) return existing
    return tx
      .insert(deferredCalls)
      .values({
        approvalId: uuidv7(),
        toolName: input.toolName,
        argumentsJson: input.argumentsJson,
        reason: input.reason,
        sourceTask: input.sourceTask,
        state: 'pending',
        createdAt: now,
        expiresAt: now + DEFERRED_CALL_TTL_MS,
      })
      .returning()
      .get()
  })
}

/** Fetch a deferred call by its `approvalId`, expiring stale rows first. */
export function getDeferredCall(
  db: LocalDb,
  approvalId: string,
  now: number,
): DeferredCallRow | undefined {
  expireDeferredCalls(db, now)
  return db.select().from(deferredCalls).where(eq(deferredCalls.approvalId, approvalId)).get()
}

/**
 * Consume an approved deferred call matching `(toolName, argumentsJson)` atomically so one
 * approval authorizes exactly one execution.
 */
export function consumeApprovedCall(
  db: LocalDb,
  toolName: string,
  argumentsJson: string,
  now: number,
): DeferredCallRow | undefined {
  return db.transaction((tx) => {
    const match = tx
      .select()
      .from(deferredCalls)
      .where(
        and(
          eq(deferredCalls.toolName, toolName),
          eq(deferredCalls.argumentsJson, argumentsJson),
          eq(deferredCalls.state, 'approved'),
          gt(deferredCalls.expiresAt, now),
        ),
      )
      .orderBy(asc(deferredCalls.createdAt))
      .limit(1)
      .get()
    if (!match) return undefined
    const updated = tx
      .update(deferredCalls)
      .set({ state: 'consumed' })
      .where(
        and(eq(deferredCalls.approvalId, match.approvalId), eq(deferredCalls.state, 'approved')),
      )
      .returning()
      .get()
    return updated
  })
}

/** Record an operator decision (`approve` or `deny`) on a pending deferred call. */
export function decideDeferredCall(
  db: LocalDb,
  approvalId: string,
  decision: 'approve' | 'deny',
  note: string | undefined,
  now: number,
): { row: DeferredCallRow; alreadyDecided: boolean } {
  return db.transaction((tx) => {
    tx.update(deferredCalls)
      .set({ state: 'expired', decidedAt: now })
      .where(and(eq(deferredCalls.state, 'pending'), lte(deferredCalls.expiresAt, now)))
      .run()
    const row = tx
      .select()
      .from(deferredCalls)
      .where(eq(deferredCalls.approvalId, approvalId))
      .get()
    if (!row) throw new Error('approval_not_found')
    const targetState = decision === 'approve' ? 'approved' : 'denied'
    if (row.state === targetState || (row.state === 'consumed' && decision === 'approve')) {
      return { row, alreadyDecided: true }
    }
    if (row.state !== 'pending') {
      throw new Error(`approval_not_pending:${row.state}`)
    }
    const updated = tx
      .update(deferredCalls)
      .set({
        state: targetState,
        operatorNote: note ?? null,
        decidedAt: now,
      })
      .where(and(eq(deferredCalls.approvalId, approvalId), eq(deferredCalls.state, 'pending')))
      .returning()
      .get()
    return { row: updated, alreadyDecided: false }
  })
}

/** Pending non-expired deferred calls for `attention()` projection, oldest first. */
export function pendingDeferredCalls(db: LocalDb, now: number): DeferredCallRow[] {
  expireDeferredCalls(db, now)
  return db
    .select()
    .from(deferredCalls)
    .where(and(eq(deferredCalls.state, 'pending'), gt(deferredCalls.expiresAt, now)))
    .orderBy(asc(deferredCalls.createdAt))
    .all()
}

/** Recent deferred calls (newest first) for inspection via RPC. */
export function listDeferredCalls(db: LocalDb, now: number, limit = 50): DeferredCallRow[] {
  expireDeferredCalls(db, now)
  return db.select().from(deferredCalls).orderBy(desc(deferredCalls.createdAt)).limit(limit).all()
}
