/**
 * Durable event inbox in each agent's SQLite: fast-ack persistence, idempotency by `requestId`,
 * burst coalescing, retry backoff, and bounded retention.
 *
 * @see docs/agents.md — Event inbox
 * @module
 */
import { parseEnum, parseJsonValue } from '../../lib/reylo.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import type { InboxEventSource, SessionMode } from '../../protocol.ts'
import type { LocalDb } from './local.ts'
import clearInboxBatchReservationQuery from './sql/clear-inbox-batch-reservation.sql'
import failInboxEvent from './sql/fail-inbox-event.sql'
import insertInboxEvent from './sql/insert-inbox-event.sql'
import markInboxAdmittedQuery from './sql/mark-inbox-admitted.sql'
import reserveInboxBatchQuery from './sql/reserve-inbox-batch.sql'
import retainInboxQuery from './sql/retain-inbox.sql'
import retryInboxEvent from './sql/retry-inbox-event.sql'
import selectInboxByRequestId from './sql/select-inbox-by-request-id.sql'
import selectNextQueuedInbox from './sql/select-next-queued-inbox.sql'
import selectNextSettledInbox from './sql/select-next-settled-inbox.sql'
import selectPendingInboxEvents from './sql/select-pending-inbox-events.sql'
import selectReservedInboxMarker from './sql/select-reserved-inbox-marker.sql'
import selectReservedInboxRows from './sql/select-reserved-inbox-rows.sql'
import settleInboxEventsQuery from './sql/settle-inbox-events.sql'

/** Maximum queued events read or coalesced in one wake. */
export const INBOX_BATCH_LIMIT = 10
/** Base retry backoff when inbox admission transiently fails. */
export const INBOX_RETRY_DELAY_MS = 10_000
/** Maximum failed admission attempts before marking an inbox item failed. */
export const INBOX_MAX_ATTEMPTS = 5
/** Keep settled/failed inbox items for 7 days for requestId deduplication, then prune. */
export const INBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

const INBOX_SOURCES = ['user', 'webhook', 'schedule', 'peer', 'mcp', 'approval'] as const
const SESSION_MODES = ['resume', 'new'] as const
const WHEN_BUSY_MODES = ['followUp', 'steer', 'interrupt'] as const
const INBOX_STATES = ['queued', 'admitted', 'settled', 'failed'] as const

/** A persisted event inbox row. */
export interface InboxEventRow {
  id: string
  requestId: string
  source: InboxEventSource
  sessionMode: SessionMode
  whenBusy: (typeof WHEN_BUSY_MODES)[number]
  payloadJson: string
  state: (typeof INBOX_STATES)[number]
  batchRequestId: string | null
  submissionId: number | null
  attempts: number
  nextRetryAt: number
  createdAt: number
  settledAt: number | null
}

function parseInboxEventRow(row: {
  id: string
  requestId: string
  source: string
  sessionMode: string
  whenBusy: string
  payloadJson: string
  state: string
  batchRequestId: string | null
  submissionId: number | null
  attempts: number
  nextRetryAt: number
  createdAt: number
  settledAt: number | null
}): InboxEventRow {
  return {
    ...row,
    source: parseEnum(INBOX_SOURCES, row.source, 'inbox source'),
    sessionMode: parseEnum(SESSION_MODES, row.sessionMode, 'inbox sessionMode'),
    whenBusy: parseEnum(WHEN_BUSY_MODES, row.whenBusy, 'inbox whenBusy'),
    state: parseEnum(INBOX_STATES, row.state, 'inbox state'),
  }
}

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
    const parsed = parseJsonValue(payloadJson)
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
  tx: LocalDb,
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
  const existing = selectInboxByRequestId.runSync(tx.sql, { requestId: input.requestId })
  if (existing !== null) return { row: parseInboxEventRow(existing), deduplicated: true }
  const payload: InboxPayload = {
    content: input.content,
    ...(input.label === undefined ? {} : { label: input.label }),
  }
  const inserted = insertInboxEvent.runSync(tx.sql, {
    id: uuidv7(),
    requestId: input.requestId,
    source: input.source,
    sessionMode: input.sessionMode,
    whenBusy: input.whenBusy,
    payloadJson: JSON.stringify(payload),
    nextRetryAt: now,
    createdAt: now,
  })
  return { row: parseInboxEventRow(inserted), deduplicated: false }
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
  return db.transactionSync(() => enqueueInboxEventInTx(db, input, now))
}

/** Look up an inbox event by caller `requestId` so coalesced callers can resolve Pi status. */
export function inboxEventByRequest(db: LocalDb, requestId: string): InboxEventRow | undefined {
  const row = selectInboxByRequestId.runSync(db.sql, { requestId })
  return row === null ? undefined : parseInboxEventRow(row)
}

/** Queued events whose retry window is due, oldest first. */
export function pendingInboxEvents(db: LocalDb, now: number): InboxEventRow[] {
  return selectPendingInboxEvents
    .runSync(db.sql, { now, limit: INBOX_BATCH_LIMIT })
    .map(parseInboxEventRow)
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
  return db.transactionSync(() => {
    const reservedMarker = selectReservedInboxMarker.runSync(db.sql)?.batchRequestId
    if (reservedMarker) {
      const reservedRows = selectReservedInboxRows
        .runSync(db.sql, { batchRequestId: reservedMarker })
        .map(parseInboxEventRow)
      if (reservedRows.length > 0) {
        return buildCoalescedBatch(reservedRows, reservedMarker)
      }
    }
    const due = selectPendingInboxEvents
      .runSync(db.sql, { now, limit: INBOX_BATCH_LIMIT })
      .map(parseInboxEventRow)
    const batch = coalesceInboxBatch(due)
    if (!batch) return undefined
    const ids = batch.batch.map((row) => row.id)
    reserveInboxBatchQuery.runSync(db.sql, {
      batchRequestId: batch.requestId,
      idsJson: JSON.stringify(ids),
    })
    return {
      ...batch,
      batch: batch.batch.map((row) => ({ ...row, batchRequestId: batch.requestId })),
    }
  })
}

/** Release batch reservation before Pi admission when a `sessionMode: 'new'` wake must defer. */
export function clearInboxBatchReservation(db: LocalDb, ids: readonly string[]): void {
  if (ids.length === 0) return
  clearInboxBatchReservationQuery.runSync(db.sql, { idsJson: JSON.stringify(ids) })
}

/** Mark a batch of inbox items admitted into Pi with the resulting submission ID. */
export function markInboxAdmitted(
  db: LocalDb,
  ids: readonly string[],
  submissionId: number,
  now: number,
): void {
  if (ids.length === 0) return
  markInboxAdmittedQuery.runSync(db.sql, {
    submissionId,
    settledAt: now,
    idsJson: JSON.stringify(ids),
  })
}

/** Mark admitted items settled once Pi reaches a terminal state (or permanent refusal clears batch). */
export function settleInboxEvents(db: LocalDb, ids: readonly string[], now: number): void {
  if (ids.length === 0) return
  settleInboxEventsQuery.runSync(db.sql, { settledAt: now, idsJson: JSON.stringify(ids) })
}

/** Back off a failed inbox batch or mark it terminally failed after `INBOX_MAX_ATTEMPTS`. */
export function retryInboxBatch(db: LocalDb, rows: readonly InboxEventRow[], now: number): void {
  db.transactionSync(() => {
    for (const row of rows) {
      const nextAttempts = row.attempts + 1
      if (nextAttempts >= INBOX_MAX_ATTEMPTS) {
        failInboxEvent.runSync(db.sql, {
          attempts: nextAttempts,
          settledAt: now,
          id: row.id,
        })
      } else {
        retryInboxEvent.runSync(db.sql, {
          attempts: nextAttempts,
          nextRetryAt: now + INBOX_RETRY_DELAY_MS * 2 ** row.attempts,
          id: row.id,
        })
      }
    }
  })
}

/** Earliest future retry or retention cleanup timestamp for the `inbox` alarm purpose. */
export function nextInboxWake(db: LocalDb): number | undefined {
  const nextQueued = selectNextQueuedInbox.runSync(db.sql)?.at
  const nextSettled = selectNextSettledInbox.runSync(db.sql)?.at
  const cleanupAt =
    nextSettled !== null && nextSettled !== undefined ? nextSettled + INBOX_RETENTION_MS : undefined
  if (nextQueued === undefined) return cleanupAt
  if (cleanupAt === undefined) return nextQueued
  return Math.min(nextQueued, cleanupAt)
}

/** Delete settled/failed/admitted rows older than `INBOX_RETENTION_MS`. */
export function retainInbox(db: LocalDb, now: number): void {
  retainInboxQuery.runSync(db.sql, { before: now - INBOX_RETENTION_MS })
}
