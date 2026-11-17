/**
 * Notification recording, burst-paced outbox dispatch, pagination, and acknowledgement workflows.
 *
 * @see docs/extensions.md — Completion and notification atomicity
 * @module
 */
import {
  EXTENSION_RETENTION_MS,
  MAX_NOTIFICATION_SUMMARY_BYTES,
  MAX_OUTBOX_DETAILS_BYTES,
} from '../extensions.ts'
import type { CompletionNotice, NotificationPage } from '../extensions.ts'
import { NotificationQuerySchema, parseInput } from '../validation.ts'
import type { LocalDb } from './local-db/local.ts'
import {
  OUTBOX_PACING_WINDOW_MS,
  dispatchCoalescedOutboxRow,
  dispatchSingleOutboxRow,
  findNotificationBySource,
  flushPendingOutboxRows,
  insertNotificationRow,
  latestOutboxNotification,
  listDuePendingOutbox,
  listNotificationRows,
  markNotificationRead,
  nextNotificationExpiry,
  nextOutboxWake,
  parseNotificationRow,
  recentOutboxSummaries,
  retainNotifications,
  suppressOutboxRows,
} from './local-db/notifications.repository.ts'
import type { NotificationRow } from './local-db/notifications.repository.ts'

export {
  OUTBOX_PACING_WINDOW_MS,
  nextNotificationExpiry,
  nextOutboxWake,
  recentOutboxSummaries,
  retainNotifications,
}
export type { NotificationRow }

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
 *
 * @returns The inserted notification, or undefined when this source was already recorded.
 */
export function recordNotification(
  db: LocalDb,
  notice: CompletionNotice,
  now: number,
): NotificationRow | undefined {
  return insertNotificationRow(db, notice, now)
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
    const existing = findNotificationBySource(db, 'outbox', input.sourceId)
    if (existing !== undefined) return existing

    if (input.urgency === 'immediate') {
      const inserted = insertNotificationRow(
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
      flushPendingOutboxRows(db, now)
      return inserted
    }

    const latest = latestOutboxNotification(db)
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

    return insertNotificationRow(
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
    const due = listDuePendingOutbox(db, now)
    if (due.length === 0) return 0
    if (due.length === 1) {
      const only = due[0]
      if (!only) return 0
      dispatchSingleOutboxRow(db, only.seq, now)
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
    dispatchCoalescedOutboxRow(db, {
      seq: target.seq,
      summary: combinedSummary,
      details: combinedDetails,
      artifactIds,
      deliverAfter: now,
    })
    suppressOutboxRows(
      db,
      due.slice(0, -1).map((row) => row.seq),
    )
    return due.length
  })
}

/** List live notifications newest first, with explicit availability of the object-local result. */
export function listNotifications(db: LocalDb, query: unknown, now: number): NotificationPage {
  const input = parseInput(NotificationQuerySchema, query)
  retainNotifications(db, now)
  const rows = listNotificationRows(db, {
    before: input.before ?? null,
    unreadOnly: input.unreadOnly,
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
  return markNotificationRead(db, seq, now)
}
