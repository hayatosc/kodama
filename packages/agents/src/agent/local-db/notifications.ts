/** Idempotent completion inserts that can share the producer's SQLite transaction.
 * @see docs/extensions.md — Completion and notification atomicity
 * @module
 */
import * as v from 'valibot'
import {
  EXTENSION_RETENTION_MS,
  MAX_NOTIFICATION_SUMMARY_BYTES,
  MAX_OUTBOX_DETAILS_BYTES,
} from '../../extensions.ts'
import type { CompletionNotice, NotificationPage } from '../../extensions.ts'
import { parseEnum, parseJsonValue } from '../../lib/reylo.ts'
import { NotificationQuerySchema, parseInput } from '../../validation.ts'
import type { LocalDb } from './local.ts'
import dispatchCoalescedOutbox from './sql/dispatch-coalesced-outbox.sql'
import dispatchSingleOutbox from './sql/dispatch-single-outbox.sql'
import flushPendingOutbox from './sql/flush-pending-outbox.sql'
import insertNotification from './sql/insert-notification.sql'
import listNotificationsQuery from './sql/list-notifications.sql'
import markNotificationRead from './sql/mark-notification-read.sql'
import retainNotificationsQuery from './sql/retain-notifications.sql'
import selectDuePendingOutbox from './sql/select-due-pending-outbox.sql'
import selectLatestOutboxNotification from './sql/select-latest-outbox-notification.sql'
import selectLiveNotificationSeq from './sql/select-live-notification-seq.sql'
import selectNextNotificationExpiry from './sql/select-next-notification-expiry.sql'
import selectNextOutboxWake from './sql/select-next-outbox-wake.sql'
import selectNotificationBySource from './sql/select-notification-by-source.sql'
import selectRecentOutboxSummaries from './sql/select-recent-outbox-summaries.sql'
import suppressOutboxBySeqs from './sql/suppress-outbox-by-seqs.sql'

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

function parseNotificationRow(row: {
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

function truncateUtf8(text: string, maxBytes: number): string {
  const encoder = new TextEncoder()
  if (encoder.encode(text).byteLength <= maxBytes) return text
  const ellipsis = '…'
  const limit = maxBytes - encoder.encode(ellipsis).byteLength
  let out = ''
  let used = 0
  for (const char of text) {
    const size = encoder.encode(char).byteLength
    if (used + size > limit) break
    out += char
    used += size
  }
  return out + ellipsis
}

/**
 * Record the first terminal result without changing a prior notification's content or read state.
 * Pass the producer's transaction to make completion and notification indivisible. Retention
 * cleanup must not remove the deduplication row while the producer can still replay completion.
 * @returns The inserted notification, or undefined when this source was already recorded.
 */
export function recordNotification(
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
  const row = insertNotification.runSync(db.sql, {
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

/**
 * Enqueue an explicit agent outbox item with burst pacing:
 * - `immediate` dispatches immediately and flushes any pending outbox items.
 * - First `normal` item outside the cooldown window dispatches immediately.
 * - Subsequent `normal` items within `OUTBOX_PACING_WINDOW_MS` queue as `pending` until the window end.
 */
export function enqueueOutboxNotification(
  db: LocalDb,
  input: {
    sourceId: string
    summary: string
    details?: string
    artifactIds: string[]
    urgency: 'normal' | 'immediate'
  },
  now: number,
): NotificationRow | undefined {
  return db.transactionSync(() => {
    const existing = selectNotificationBySource.runSync(db.sql, {
      source: 'outbox',
      sourceId: input.sourceId,
    })
    if (existing !== null) return parseNotificationRow(existing)

    if (input.urgency === 'immediate') {
      const inserted = recordNotification(
        db,
        {
          source: 'outbox',
          sourceId: input.sourceId,
          outcome: 'succeeded',
          summary: input.summary,
          ...(input.details === undefined ? {} : { details: input.details }),
          artifactIds: input.artifactIds,
          deliveryState: 'dispatched',
          deliverAfter: now,
        },
        now,
      )
      flushPendingOutbox.runSync(db.sql, { deliverAfter: now })
      return inserted
    }

    const latestRaw = selectLatestOutboxNotification.runSync(db.sql)
    const latest = latestRaw === null ? undefined : parseNotificationRow(latestRaw)

    const latestDispatchedAt = latest?.deliverAfter ?? latest?.createdAt
    const inCooldown =
      latest !== undefined &&
      (latest.deliveryState === 'pending' ||
        (latestDispatchedAt !== undefined && latestDispatchedAt > now - OUTBOX_PACING_WINDOW_MS))
    const deliverAfter = inCooldown
      ? latest.deliveryState === 'pending' && latest.deliverAfter !== null
        ? Math.max(now + 1, latest.deliverAfter)
        : (latestDispatchedAt ?? now) + OUTBOX_PACING_WINDOW_MS
      : now

    return recordNotification(
      db,
      {
        source: 'outbox',
        sourceId: input.sourceId,
        outcome: 'succeeded',
        summary: input.summary,
        ...(input.details === undefined ? {} : { details: input.details }),
        artifactIds: input.artifactIds,
        deliveryState: inCooldown ? 'pending' : 'dispatched',
        deliverAfter,
      },
      now,
    )
  })
}

/** Flush due pending outbox notifications, coalescing multiple normal items in one window. */
export function dispatchDueOutbox(db: LocalDb, now: number): number {
  return db.transactionSync(() => {
    const due = selectDuePendingOutbox.runSync(db.sql, { now }).map(parseNotificationRow)
    if (due.length === 0) return 0
    if (due.length === 1) {
      const only = due[0]
      if (!only) return 0
      dispatchSingleOutbox.runSync(db.sql, { deliverAfter: now, seq: only.seq })
      return 1
    }
    const target = due.at(-1)
    if (!target) return 0
    const combinedSummary = truncateUtf8(
      due.map((row) => row.summary).join('\n• '),
      MAX_NOTIFICATION_SUMMARY_BYTES,
    )
    const detailParts = due
      .map((row) => row.details)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
    const combinedDetails = detailParts.length
      ? truncateUtf8(detailParts.join('\n\n---\n\n'), MAX_OUTBOX_DETAILS_BYTES)
      : null
    const artifactIds = Array.from(new Set(due.flatMap((row) => row.artifactIds))).slice(0, 16)
    dispatchCoalescedOutbox.runSync(db.sql, {
      summary: combinedSummary,
      details: combinedDetails,
      artifactIdsJson: JSON.stringify(artifactIds),
      deliverAfter: now,
      seq: target.seq,
    })
    const suppressedSeqs = due.slice(0, -1).map((row) => row.seq)
    if (suppressedSeqs.length > 0) {
      suppressOutboxBySeqs.runSync(db.sql, { seqsJson: JSON.stringify(suppressedSeqs) })
    }
    return due.length
  })
}

/** Earliest pending outbox dispatch timestamp, if any. */
export function nextOutboxWake(db: LocalDb): number | undefined {
  return selectNextOutboxWake.runSync(db.sql)?.at ?? undefined
}

/** Recent dispatched outbox messages shown to the agent to avoid duplicate proactive alerts. */
export function recentOutboxSummaries(
  db: LocalDb,
  limit = 5,
): { seq: number; summary: string; createdAt: number }[] {
  return selectRecentOutboxSummaries.runSync(db.sql, { limit }).reverse()
}

/** Delete only inbox metadata; producers must insert exclusively on their first terminal transition. */
export function retainNotifications(db: LocalDb, now: number): void {
  retainNotificationsQuery.runSync(db.sql, { now })
}

/** The existing schedule alarm also removes unread or read metadata when its retention ends. */
export function nextNotificationExpiry(db: LocalDb): number | undefined {
  return selectNextNotificationExpiry.runSync(db.sql)?.at
}

/** List live notifications newest first, with explicit availability of the object-local result. */
export function listNotifications(db: LocalDb, query: unknown, now: number): NotificationPage {
  const input = parseInput(NotificationQuerySchema, query)
  retainNotifications(db, now)
  const rows = listNotificationsQuery.runSync(db.sql, {
    before: input.before ?? null,
    unreadOnly: input.unreadOnly ? 1 : 0,
    now,
    limit: input.limit + 1,
  })
  const page = rows.slice(0, input.limit)
  const last = page.at(-1)
  return {
    notifications: page.map((row) => {
      const notification = parseNotificationRow(row)
      const selfContained =
        notification.source === 'mcp' ||
        notification.source === 'outbox' ||
        notification.source === 'approval'
      const expiresAt =
        notification.source === 'schedule'
          ? row.scheduleSettledAt === null
            ? undefined
            : row.scheduleSettledAt + EXTENSION_RETENTION_MS
          : selfContained
            ? notification.expiresAt
            : (row.contactExpiresAt ?? undefined)
      const exists =
        selfContained ||
        (notification.source === 'schedule' ? row.scheduleId !== null : row.contactId !== null)
      const available =
        selfContained ||
        (notification.source === 'schedule'
          ? row.scheduleSettledAt !== null
          : row.contactResultJson !== null)
      const { details, deliverAfter, ...base } = notification
      return {
        ...base,
        ...(details === null ? {} : { details }),
        ...(deliverAfter === null ? {} : { deliverAfter }),
        referenceState:
          !exists || (expiresAt != null && expiresAt <= now)
            ? 'expired'
            : available
              ? 'available'
              : 'unavailable',
      }
    }),
    ...(rows.length > input.limit && last ? { nextBefore: last.seq } : {}),
  }
}

/** Acknowledge only one live sequence; retries preserve the first server-generated timestamp. */
export function readNotification(db: LocalDb, seq: number, now: number): boolean {
  retainNotifications(db, now)
  markNotificationRead.runSync(db.sql, { now, seq, expiresAfter: now })
  return selectLiveNotificationSeq.runSync(db.sql, { seq, now }) !== null
}
