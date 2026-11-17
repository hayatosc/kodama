/**
 * Durable notification and outbox persistence in each agent's SQLite.
 *
 * @see docs/extensions.md — Completion and notification atomicity
 * @module
 */
import * as v from 'valibot'
import {
  EXTENSION_RETENTION_MS,
  MAX_NOTIFICATION_SUMMARY_BYTES,
  MAX_OUTBOX_DETAILS_BYTES,
} from '../../extensions.ts'
import type { CompletionNotice } from '../../extensions.ts'
import { parseEnum, parseJsonValue } from '../../lib/reylo.ts'
import type { LocalDb } from './local.ts'
import { queries } from './queries/index.ts'

/** Cooldown window for pacing consecutive normal-urgency outbox alerts. */
export const OUTBOX_PACING_WINDOW_MS = 60_000

const NOTIFICATION_SOURCES = ['contact', 'schedule', 'mcp', 'outbox', 'approval'] as const
const COMPLETION_OUTCOMES = ['succeeded', 'failed', 'cancelled', 'unanswered'] as const
const DELIVERY_STATES = ['pending', 'dispatched', 'suppressed'] as const
const artifactIdsSchema = v.array(v.string())

/** Persisted notification row decoded from SQLite. */
export interface NotificationRow {
  seq: number
  source: (typeof NOTIFICATION_SOURCES)[number]
  sourceId: string
  outcome: (typeof COMPLETION_OUTCOMES)[number]
  summary: string
  details: string | null
  artifactIds: string[]
  deliveryState: (typeof DELIVERY_STATES)[number]
  deliverAfter: number | null
  createdAt: number
  expiresAt: number
  readAt: number | null
}

/** Joined notification + referenced schedule/contact state row from `listNotifications`. */
export interface JoinedNotificationRow {
  seq: number
  source: string
  sourceId: string
  outcome: string
  summary: string
  details: string | null
  artifactIdsJson: string
  deliveryState: string
  deliverAfter: number | null
  createdAt: number
  expiresAt: number
  readAt: number | null
  scheduleId: string | null
  scheduleSettledAt: number | null
  contactId: string | null
  contactResultJson: string | null
  contactExpiresAt: number | null
}

/** Parse a raw SQLite notification row into typed domain fields. */
export function parseNotificationRow(row: {
  seq: number
  source: string
  sourceId: string
  outcome: string
  summary: string
  details: string | null
  artifactIdsJson: string
  deliveryState: string
  deliverAfter: number | null
  createdAt: number
  expiresAt: number
  readAt: number | null
}): NotificationRow {
  return {
    seq: row.seq,
    source: parseEnum(NOTIFICATION_SOURCES, row.source, 'notification source'),
    sourceId: row.sourceId,
    outcome: parseEnum(COMPLETION_OUTCOMES, row.outcome, 'notification outcome'),
    summary: row.summary,
    details: row.details,
    artifactIds: v.parse(artifactIdsSchema, parseJsonValue(row.artifactIdsJson)),
    deliveryState: parseEnum(DELIVERY_STATES, row.deliveryState, 'notification deliveryState'),
    deliverAfter: row.deliverAfter,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    readAt: row.readAt,
  }
}

/**
 * Insert the first terminal notification for `(source, sourceId)` without altering prior content.
 *
 * @returns The inserted notification, or undefined when this source was already recorded.
 */
export function insertNotificationRow(
  db: LocalDb,
  notice: CompletionNotice,
  now: number,
): NotificationRow | undefined {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + EXTENSION_RETENTION_MS))
    throw new TypeError('Invalid notification timestamp')
  if (notice.sourceId.length === 0 || notice.sourceId.length > 256)
    throw new TypeError('Invalid notification source ID')
  if (new TextEncoder().encode(notice.summary).byteLength > MAX_NOTIFICATION_SUMMARY_BYTES)
    throw new TypeError('Notification summary exceeds byte limit')
  if (
    notice.details !== undefined &&
    new TextEncoder().encode(notice.details).byteLength > MAX_OUTBOX_DETAILS_BYTES
  )
    throw new TypeError('Notification details exceed byte limit')
  if (
    notice.artifactIds.length > 16 ||
    notice.artifactIds.some((id) => id.length === 0 || id.length > 128)
  )
    throw new TypeError('Invalid notification artifact references')
  const row = queries.insertNotification.runSync(db.sql, {
    source: notice.source,
    sourceId: notice.sourceId,
    outcome: notice.outcome,
    summary: notice.summary,
    details: notice.details ?? null,
    artifactIdsJson: JSON.stringify(notice.artifactIds),
    deliveryState: notice.deliveryState ?? 'dispatched',
    deliverAfter: notice.deliverAfter ?? null,
    createdAt: now,
    expiresAt: now + EXTENSION_RETENTION_MS,
  })
  return row === null ? undefined : parseNotificationRow(row)
}

/** Look up an existing notification by `(source, sourceId)`. */
export function findNotificationBySource(
  db: LocalDb,
  source: NotificationRow['source'],
  sourceId: string,
): NotificationRow | undefined {
  const row = queries.getNotificationBySource.runSync(db.sql, { source, sourceId })
  return row === null ? undefined : parseNotificationRow(row)
}

/** Flush all pending outbox items to dispatched at `deliverAfter`. */
export function flushPendingOutboxRows(db: LocalDb, deliverAfter: number): void {
  queries.updateFlushPendingOutbox.runSync(db.sql, { deliverAfter })
}

/** Read the newest outbox notification row for pacing checks. */
export function latestOutboxNotification(db: LocalDb): NotificationRow | undefined {
  const row = queries.getLatestOutboxNotification.runSync(db.sql)
  return row === null ? undefined : parseNotificationRow(row)
}

/** List pending outbox notifications whose `deliverAfter` has arrived. */
export function listDuePendingOutbox(db: LocalDb, now: number): NotificationRow[] {
  return queries.listDuePendingOutbox.runSync(db.sql, { now }).map(parseNotificationRow)
}

/** Mark one pending outbox notification dispatched. */
export function dispatchSingleOutboxRow(db: LocalDb, seq: number, deliverAfter: number): void {
  queries.updateDispatchSingleOutbox.runSync(db.sql, { deliverAfter, seq })
}

/** Update the target notification with coalesced outbox content and mark it dispatched. */
export function dispatchCoalescedOutboxRow(
  db: LocalDb,
  input: {
    seq: number
    summary: string
    details: string | null
    artifactIds: string[]
    deliverAfter: number
  },
): void {
  queries.updateDispatchCoalescedOutbox.runSync(db.sql, {
    summary: input.summary,
    details: input.details,
    artifactIdsJson: JSON.stringify(input.artifactIds),
    deliverAfter: input.deliverAfter,
    seq: input.seq,
  })
}

/** Mark coalesced earlier outbox items as suppressed. */
export function suppressOutboxRows(db: LocalDb, seqs: readonly number[]): void {
  if (seqs.length === 0) return
  queries.updateSuppressOutboxBySeqs.runSync(db.sql, { seqsJson: JSON.stringify(seqs) })
}

/** Earliest pending outbox dispatch timestamp, if any. */
export function nextOutboxWake(db: LocalDb): number | undefined {
  return queries.getNextOutboxWake.runSync(db.sql)?.at ?? undefined
}

/** Recent dispatched outbox messages shown to the agent to avoid duplicate proactive alerts. */
export function recentOutboxSummaries(
  db: LocalDb,
  limit = 5,
): { seq: number; summary: string; createdAt: number }[] {
  return queries.listRecentOutboxSummaries.runSync(db.sql, { limit }).reverse()
}

/** Delete only expired inbox notification rows; producers retain their own deduplication tombstones. */
export function retainNotifications(db: LocalDb, now: number): void {
  queries.deleteRetainNotifications.runSync(db.sql, { now })
}

/** Earliest expiry timestamp of remaining notifications. */
export function nextNotificationExpiry(db: LocalDb): number | undefined {
  return queries.getNextNotificationExpiry.runSync(db.sql)?.at
}

/** Query live notifications newest first with joined schedule/contact availability fields. */
export function listNotificationRows(
  db: LocalDb,
  input: { before: number | null; unreadOnly: boolean; now: number; limit: number },
): JoinedNotificationRow[] {
  return queries.listNotifications.runSync(db.sql, {
    before: input.before,
    unreadOnly: input.unreadOnly ? 1 : 0,
    now: input.now,
    limit: input.limit,
  })
}

/** Mark one live notification read, preserving the first `readAt` timestamp. */
export function markNotificationRead(db: LocalDb, seq: number, now: number): boolean {
  queries.updateMarkNotificationRead.runSync(db.sql, { now, seq, expiresAfter: now })
  return queries.getLiveNotificationSeq.runSync(db.sql, { seq, now }) !== null
}
