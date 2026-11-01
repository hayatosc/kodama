/** Durable contact outbox, receiver receipts, and atomic sender completion.
 * @see docs/extensions.md — Completion and notification atomicity
 * @module
 */
import { and, count, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm'
import {
  contactRequests as requests,
  contactReceipts as receipts,
} from '../../../drizzle/durable-object/schema.ts'
import { EXTENSION_RETENTION_MS } from '../../extensions.ts'
import type { ContactResult } from '../../extensions.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import type { LocalDb } from './local.ts'
import { recordNotification } from './notifications.ts'

/** Immutable sender identity and recoverable delivery progress. */
export type ContactRequest = typeof requests.$inferSelect
/** A receiver admission fence; submissionId zero means acceptance must be recovered from Pi. */
export type ContactReceipt = typeof receipts.$inferSelect
const pending = inArray(requests.state, ['dispatching', 'submitted'])

/** Find the sender's immutable record, including expired replay tombstones. */
export function contactRequest(db: LocalDb, id: string) {
  return db.select().from(requests).where(eq(requests.id, id)).get()
}

/** Replay requires identical arguments, not merely the same tool task or RPC request ID. */
export function contactReplay(db: LocalDb, sourceTask: string, args: string) {
  const row = db.select().from(requests).where(eq(requests.sourceTask, sourceTask)).get()
  if (row && row.arguments !== args) throw new TypeError('contact_replay_mismatch')
  return row
}

/** Reserve before dispatch; the source identity comes from a validated execution or private RPC. */
export function reserveContact(
  db: LocalDb,
  input: Pick<
    ContactRequest,
    'sourceTask' | 'sourceEntry' | 'arguments' | 'targetAgentId' | 'content' | 'hop'
  >,
  now: number,
): ContactRequest {
  const open = db.select({ value: count() }).from(requests).where(pending).get()?.value ?? 0
  if (open >= 100) throw new Error('contact_quota: maximum 100 pending contacts')
  const id = uuidv7()
  return db
    .insert(requests)
    .values({
      ...input,
      id,
      requestId: `peer-${id}`,
      state: 'dispatching',
      retryAt: now,
      createdAt: now,
    })
    .returning()
    .get()
}

/** Pending dispatches plus terminal results whose receiver acknowledgement still needs retry. */
export function actionableContacts(db: LocalDb, now?: number) {
  return db
    .select()
    .from(requests)
    .where(
      and(
        or(pending, gt(requests.retryAt, 0)),
        now === undefined ? undefined : lte(requests.retryAt, now),
      ),
    )
    .orderBy(requests.retryAt, requests.id)
    .limit(100)
    .all()
}

/** Record acceptance without confusing it with successful completion. */
export function acceptContact(db: LocalDb, id: string, submissionId: number, now: number) {
  db.update(requests)
    .set({ state: 'submitted', submissionId, retryAt: now + 60_000 })
    .where(and(eq(requests.id, id), pending))
    .run()
}

/** Poll accepted work at a steady interval without treating pending as a transport failure. */
export function deferContact(db: LocalDb, id: string, now: number) {
  db.update(requests)
    .set({ retryAt: now + 60_000 })
    .where(and(eq(requests.id, id), pending))
    .run()
}

/** Back off without discarding an ambiguous admission or an unacknowledged result. */
export function retryContact(db: LocalDb, id: string, now: number) {
  const row = contactRequest(db, id)
  if (!row) return
  db.update(requests)
    .set({
      attempts: row.attempts + 1,
      retryAt: now + Math.min(3_600_000, 60_000 * 2 ** Math.min(row.attempts, 6)),
    })
    .where(eq(requests.id, id))
    .run()
}

/** The first terminal transition and notification are one transaction; replay cannot recreate it. */
export function settleContact(
  db: LocalDb,
  id: string,
  result: ContactResult,
  now: number,
  needsAck = true,
) {
  db.transaction((tx) => {
    const row = tx.select().from(requests).where(eq(requests.id, id)).get()
    if (!row || row.settledAt !== null) return
    tx.update(requests)
      .set({
        state: result.outcome === 'failed' ? 'failed' : 'settled',
        result,
        settledAt: now,
        expiresAt: now + EXTENSION_RETENTION_MS,
        retryAt: needsAck ? now : 0,
      })
      .where(eq(requests.id, id))
      .run()
    recordNotification(
      tx,
      {
        source: 'contact',
        sourceId: id,
        outcome: result.outcome,
        summary: `Contact ${id} to agent ${row.targetAgentId}: ${result.outcome}.`,
        artifactIds: result.artifactIds,
      },
      now,
    )
  })
}

/** Stop acknowledgement retries only after the receiver durably confirms them. */
export function finishContactAcknowledgement(db: LocalDb, id: string) {
  db.update(requests)
    .set({ retryAt: 0 })
    .where(and(eq(requests.id, id), gt(requests.settledAt, 0)))
    .run()
}

/** Receiver lookup is always scoped by the validated sender and stable request identity. */
export function contactReceipt(db: LocalDb, senderAgentId: string, requestId: string) {
  return db
    .select()
    .from(receipts)
    .where(and(eq(receipts.senderAgentId, senderAgentId), eq(receipts.requestId, requestId)))
    .get()
}

/** Fence pruning before Pi admission, including the stop between admission and saving its ID. */
export function reserveReceipt(db: LocalDb, senderAgentId: string, requestId: string, now: number) {
  db.insert(receipts)
    .values({ senderAgentId, requestId, submissionId: 0, createdAt: now })
    .onConflictDoNothing()
    .run()
  const row = contactReceipt(db, senderAgentId, requestId)
  if (!row) throw new Error('contact_receipt_missing')
  return row
}

/** Receipts not yet terminal must be reconciled before any Pi history deletion. */
export function pendingContactReceipts(db: LocalDb) {
  return db.select().from(receipts).where(isNull(receipts.settledAt)).all()
}

/** Save the accepted Pi identity or its terminal answer before pruning can remove either. */
export function updateReceipt(
  db: LocalDb,
  receipt: ContactReceipt,
  submissionId: number,
  result?: ContactResult,
  now = Date.now(),
) {
  db.update(receipts)
    .set({ submissionId, ...(result ? { result, settledAt: now } : {}) })
    .where(
      and(
        eq(receipts.senderAgentId, receipt.senderAgentId),
        eq(receipts.requestId, receipt.requestId),
        isNull(receipts.settledAt),
      ),
    )
    .run()
}

/** Receiver retention begins only after the sender's atomic completion has been verified. */
export function acknowledgeReceipt(db: LocalDb, receipt: ContactReceipt, now: number) {
  db.update(receipts)
    .set({ acknowledgedAt: now, expiresAt: now + EXTENSION_RETENTION_MS })
    .where(
      and(
        eq(receipts.senderAgentId, receipt.senderAgentId),
        eq(receipts.requestId, receipt.requestId),
        isNull(receipts.acknowledgedAt),
      ),
    )
    .run()
}

/** Clear answer payloads, never replay evidence; pending and unacknowledged receipts do not expire. */
export function retainContacts(db: LocalDb, now: number) {
  db.update(requests)
    .set({ result: null })
    .where(and(lte(requests.expiresAt, now), eq(requests.retryAt, 0)))
    .run()
  db.update(receipts).set({ result: null }).where(lte(receipts.expiresAt, now)).run()
}

/** Schedule pending work, ack retries, and answer expiry through the existing purpose scheduler. */
export function nextContactWake(db: LocalDb): number | undefined {
  const work = actionableContacts(db)[0]?.retryAt
  const senderExpiry = db
    .select({ at: requests.expiresAt })
    .from(requests)
    .where(and(gt(requests.expiresAt, Date.now()), eq(requests.retryAt, 0)))
    .orderBy(requests.expiresAt)
    .limit(1)
    .get()?.at
  const receiverExpiry = db
    .select({ at: receipts.expiresAt })
    .from(receipts)
    .where(gt(receipts.expiresAt, Date.now()))
    .orderBy(receipts.expiresAt)
    .limit(1)
    .get()?.at
  const times = [work, senderExpiry, receiverExpiry].filter(
    (at): at is number => at !== null && at !== undefined,
  )
  return times.length ? Math.min(...times) : undefined
}

/** Stable local pagination does not leak peer settings, dispatch text, or source provenance. */
export function listContacts(db: LocalDb, cursor?: string, limit = 50) {
  const rows = db
    .select()
    .from(requests)
    .where(cursor ? gt(requests.id, cursor) : undefined)
    .orderBy(requests.id)
    .limit(limit + 1)
    .all()
  return {
    contacts: rows.slice(0, limit).map((row) => contactView(row, false)),
    nextCursor: rows.length > limit ? rows[limit - 1]?.id : undefined,
  }
}

/** Public local result view reports pending, terminal outcome, and expired payloads explicitly. */
export function contactView(row: ContactRequest, includeResult: boolean, now = Date.now()) {
  const expired = row.expiresAt !== null && row.expiresAt <= now
  return {
    contactId: row.id,
    agentId: row.targetAgentId,
    requestId: row.requestId,
    submissionId: row.submissionId,
    status:
      row.settledAt === null
        ? 'pending'
        : row.result?.outcome === 'succeeded'
          ? 'answered'
          : (row.result?.outcome ?? 'expired'),
    state: row.state,
    createdAt: row.createdAt,
    settledAt: row.settledAt,
    expiresAt: row.expiresAt,
    expired,
    ...(includeResult && !expired && row.result
      ? {
          result: row.result,
          answer: row.result.outcome === 'succeeded' ? row.result.text : undefined,
          truncated: row.result.truncated,
        }
      : {}),
  }
}
