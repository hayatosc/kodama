/**
 * Durable event inbox in each agent's SQLite: fast-ack persistence, idempotency by `requestId`,
 * burst coalescing, retry backoff, and bounded retention.
 *
 * @see docs/agents.md — Event inbox
 * @module
 */
import { and, asc, eq, inArray, isNotNull, lte } from 'drizzle-orm'
import { eventInbox } from '../../../drizzle/durable-object/schema.ts'
import type { InboxEventSource, SessionMode } from '../../protocol.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import type { LocalDb } from './local.ts'

/** Maximum queued events read or coalesced in one wake. */
export const INBOX_BATCH_LIMIT = 10
/** Base retry backoff when inbox admission transiently fails. */
export const INBOX_RETRY_DELAY_MS = 10_000
/** Maximum failed admission attempts before marking an inbox item failed. */
export const INBOX_MAX_ATTEMPTS = 5
/** Keep settled/failed inbox items for 7 days for requestId deduplication, then prune. */
export const INBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/** A persisted event inbox row. */
export type InboxEventRow = typeof eventInbox.$inferSelect

/** Serialized event payload inside `eventInbox.payloadJson`. */
export interface InboxPayload {
  content: string
  label?: string
}

/** A cohesive batch of queued inbox events sharing session mode and trust source. */
export interface CoalescedInboxBatch {
  batch: InboxEventRow[]
  sessionMode: SessionMode
  whenBusy: 'followUp' | 'steer' | 'interrupt'
  requestId: string
  content: string
  primarySource: InboxEventSource
}

/** Parse a stored `payloadJson` field safely. */
export function parseInboxPayload(payloadJson: string): InboxPayload {
  try {
    const parsed: unknown = JSON.parse(payloadJson)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'content' in parsed &&
      typeof parsed.content === 'string'
    ) {
      return {
        content: parsed.content,
        ...('label' in parsed && typeof parsed.label === 'string' ? { label: parsed.label } : {}),
      }
    }
  } catch {
    /* Fall back to raw text if payloadJson was malformed. */
  }
  return { content: payloadJson }
}

/** Insert or deduplicate an inbox event inside an existing SQLite transaction. */
export function enqueueInboxEventInTx(
  tx: Pick<LocalDb, 'select' | 'insert'>,
  input: {
    requestId: string
    source: InboxEventSource
    sessionMode: SessionMode
    whenBusy: 'followUp' | 'steer' | 'interrupt'
    content: string
    label?: string
  },
  now: number,
): { row: InboxEventRow; deduplicated: boolean } {
  const existing = tx
    .select()
    .from(eventInbox)
    .where(eq(eventInbox.requestId, input.requestId))
    .get()
  if (existing) return { row: existing, deduplicated: true }
  const payload: InboxPayload = {
    content: input.content,
    ...(input.label === undefined ? {} : { label: input.label }),
  }
  const inserted = tx
    .insert(eventInbox)
    .values({
      id: uuidv7(),
      requestId: input.requestId,
      source: input.source,
      sessionMode: input.sessionMode,
      whenBusy: input.whenBusy,
      payloadJson: JSON.stringify(payload),
      state: 'queued',
      attempts: 0,
      nextRetryAt: now,
      createdAt: now,
    })
    .returning()
    .get()
  return { row: inserted, deduplicated: false }
}

/**
 * Persist an inbound event immediately without waiting for OAuth, D1, or Pi admission.
 * Deduplicates by `requestId` so duplicate webhook/user deliveries return the existing row.
 */
export function enqueueInboxEvent(
  db: LocalDb,
  input: {
    requestId: string
    source: InboxEventSource
    sessionMode: SessionMode
    whenBusy: 'followUp' | 'steer' | 'interrupt'
    content: string
    label?: string
  },
  now: number,
): { row: InboxEventRow; deduplicated: boolean } {
  return db.transaction((tx) => enqueueInboxEventInTx(tx, input, now))
}

/** Look up an inbox event by caller `requestId` so coalesced callers can resolve Pi status. */
export function inboxEventByRequest(
  db: Pick<LocalDb, 'select'>,
  requestId: string,
): InboxEventRow | undefined {
  return db.select().from(eventInbox).where(eq(eventInbox.requestId, requestId)).get()
}

/** Queued events whose retry window is due, oldest first. */
export function pendingInboxEvents(db: LocalDb, now: number): InboxEventRow[] {
  return db
    .select()
    .from(eventInbox)
    .where(and(eq(eventInbox.state, 'queued'), lte(eventInbox.nextRetryAt, now)))
    .orderBy(asc(eventInbox.createdAt), asc(eventInbox.id))
    .limit(INBOX_BATCH_LIMIT)
    .all()
}

function buildCoalescedBatch(
  batch: InboxEventRow[],
  batchRequestId?: string,
): CoalescedInboxBatch | undefined {
  const first = batch[0]
  if (!first) return undefined
  const rank = (mode: InboxEventRow['whenBusy']) =>
    mode === 'interrupt' ? 2 : mode === 'steer' ? 1 : 0
  let whenBusy = first.whenBusy
  for (const row of batch) {
    if (rank(row.whenBusy) > rank(whenBusy)) whenBusy = row.whenBusy
  }
  const requestId = batchRequestId ?? first.requestId
  if (batch.length === 1) {
    const payload = parseInboxPayload(first.payloadJson)
    const prefix =
      first.source === 'user'
        ? ''
        : `[Event source=${first.source}${payload.label ? ` (${payload.label})` : ''}]\n`
    return {
      batch,
      sessionMode: first.sessionMode,
      whenBusy,
      requestId,
      content: `${prefix}${payload.content}`,
      primarySource: first.source,
    }
  }
  const lines = batch.map((row, index) => {
    const payload = parseInboxPayload(row.payloadJson)
    return `--- Event ${index + 1}/${batch.length} (source=${row.source}${payload.label ? `, label=${payload.label}` : ''}, id=${row.requestId}) ---\n${payload.content}`
  })
  return {
    batch,
    sessionMode: first.sessionMode,
    whenBusy,
    requestId,
    content: `[Coalesced ${batch.length} queued events]\n${lines.join('\n')}`,
    primarySource: first.source,
  }
}

/**
 * Group a contiguous run of queued events that share both `sessionMode` and `source` so external
 * events never promote to direct-operator provenance or mix trust origins.
 */
export function coalesceInboxBatch(
  rows: readonly InboxEventRow[],
): CoalescedInboxBatch | undefined {
  const first = rows[0]
  if (!first) return undefined
  const batch: InboxEventRow[] = [first]
  for (const row of rows.slice(1)) {
    if (row.sessionMode !== first.sessionMode || row.source !== first.source) break
    batch.push(row)
  }
  return buildCoalescedBatch(batch)
}

/**
 * Atomically claim or resume a durable batch in `eventInbox` before Pi admission so crash recovery
 * marks only the events that actually belonged to the admitted submission.
 */
export function reserveInboxBatch(db: LocalDb, now: number): CoalescedInboxBatch | undefined {
  return db.transaction((tx) => {
    const reservedMarker = tx
      .select({ batchRequestId: eventInbox.batchRequestId })
      .from(eventInbox)
      .where(and(eq(eventInbox.state, 'queued'), isNotNull(eventInbox.batchRequestId)))
      .orderBy(asc(eventInbox.createdAt), asc(eventInbox.id))
      .limit(1)
      .get()?.batchRequestId
    if (reservedMarker) {
      const reservedRows = tx
        .select()
        .from(eventInbox)
        .where(and(eq(eventInbox.state, 'queued'), eq(eventInbox.batchRequestId, reservedMarker)))
        .orderBy(asc(eventInbox.createdAt), asc(eventInbox.id))
        .all()
      if (reservedRows.length > 0) {
        return buildCoalescedBatch(reservedRows, reservedMarker)
      }
    }
    const due = tx
      .select()
      .from(eventInbox)
      .where(and(eq(eventInbox.state, 'queued'), lte(eventInbox.nextRetryAt, now)))
      .orderBy(asc(eventInbox.createdAt), asc(eventInbox.id))
      .limit(INBOX_BATCH_LIMIT)
      .all()
    const batch = coalesceInboxBatch(due)
    if (!batch) return undefined
    const ids = batch.batch.map((row) => row.id)
    tx.update(eventInbox)
      .set({ batchRequestId: batch.requestId })
      .where(inArray(eventInbox.id, ids))
      .run()
    return {
      ...batch,
      batch: batch.batch.map((row) => ({ ...row, batchRequestId: batch.requestId })),
    }
  })
}

/** Release batch reservation before Pi admission when a `sessionMode: 'new'` wake must defer. */
export function clearInboxBatchReservation(db: LocalDb, ids: readonly string[]): void {
  if (ids.length === 0) return
  db.update(eventInbox)
    .set({ batchRequestId: null })
    .where(and(inArray(eventInbox.id, [...ids]), eq(eventInbox.state, 'queued')))
    .run()
}

/** Mark a batch of inbox items admitted into Pi with the resulting submission ID. */
export function markInboxAdmitted(
  db: LocalDb,
  ids: readonly string[],
  submissionId: number,
  now: number,
): void {
  if (ids.length === 0) return
  db.update(eventInbox)
    .set({ state: 'admitted', submissionId, settledAt: now })
    .where(inArray(eventInbox.id, [...ids]))
    .run()
}

/** Mark admitted items settled once Pi reaches a terminal state (or permanent refusal clears batch). */
export function settleInboxEvents(db: LocalDb, ids: readonly string[], now: number): void {
  if (ids.length === 0) return
  db.update(eventInbox)
    .set({ state: 'settled', batchRequestId: null, settledAt: now })
    .where(inArray(eventInbox.id, [...ids]))
    .run()
}

/** Back off a failed inbox batch or mark it terminally failed after `INBOX_MAX_ATTEMPTS`. */
export function retryInboxBatch(db: LocalDb, rows: readonly InboxEventRow[], now: number): void {
  db.transaction((tx) => {
    for (const row of rows) {
      const nextAttempts = row.attempts + 1
      if (nextAttempts >= INBOX_MAX_ATTEMPTS) {
        tx.update(eventInbox)
          .set({ state: 'failed', batchRequestId: null, attempts: nextAttempts, settledAt: now })
          .where(eq(eventInbox.id, row.id))
          .run()
      } else {
        tx.update(eventInbox)
          .set({
            batchRequestId: null,
            attempts: nextAttempts,
            nextRetryAt: now + INBOX_RETRY_DELAY_MS * 2 ** row.attempts,
          })
          .where(eq(eventInbox.id, row.id))
          .run()
      }
    }
  })
}

/** Earliest future retry or retention cleanup timestamp for the `inbox` alarm purpose. */
export function nextInboxWake(db: LocalDb): number | undefined {
  const nextQueued = db
    .select({ at: eventInbox.nextRetryAt })
    .from(eventInbox)
    .where(eq(eventInbox.state, 'queued'))
    .orderBy(asc(eventInbox.nextRetryAt))
    .limit(1)
    .get()?.at
  const nextSettled = db
    .select({ at: eventInbox.settledAt })
    .from(eventInbox)
    .where(inArray(eventInbox.state, ['admitted', 'settled', 'failed']))
    .orderBy(asc(eventInbox.settledAt))
    .limit(1)
    .get()?.at
  const cleanupAt =
    nextSettled !== null && nextSettled !== undefined ? nextSettled + INBOX_RETENTION_MS : undefined
  if (nextQueued === undefined) return cleanupAt
  if (cleanupAt === undefined) return nextQueued
  return Math.min(nextQueued, cleanupAt)
}

/** Delete settled/failed/admitted rows older than `INBOX_RETENTION_MS`. */
export function retainInbox(db: LocalDb, now: number): void {
  db.delete(eventInbox)
    .where(
      and(
        inArray(eventInbox.state, ['admitted', 'settled', 'failed']),
        lte(eventInbox.settledAt, now - INBOX_RETENTION_MS),
      ),
    )
    .run()
}
