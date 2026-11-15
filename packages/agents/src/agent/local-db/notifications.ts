/** Idempotent completion inserts that can share the producer's SQLite transaction.
 * @see docs/extensions.md — Completion and notification atomicity
 * @module
 */
import { and, asc, desc, eq, gt, inArray, isNull, lt, lte } from 'drizzle-orm'
import {
  contactRequests,
  notifications,
  scheduledTaskOccurrences,
} from '../../../drizzle/durable-object/schema.ts'
import {
  EXTENSION_RETENTION_MS,
  MAX_NOTIFICATION_SUMMARY_BYTES,
  MAX_OUTBOX_DETAILS_BYTES,
} from '../../extensions.ts'
import type { CompletionNotice, NotificationPage } from '../../extensions.ts'
import { NotificationQuerySchema, parseInput } from '../../validation.ts'
import type { LocalDb } from './local.ts'

/** Cooldown window for pacing consecutive normal-urgency outbox alerts. */
export const OUTBOX_PACING_WINDOW_MS = 60_000

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
  db: Pick<LocalDb, 'insert'>,
  notice: CompletionNotice,
  now: number,
) {
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
  return db
    .insert(notifications)
    .values({
      source: notice.source,
      sourceId: notice.sourceId,
      outcome: notice.outcome,
      summary: notice.summary,
      details: notice.details ?? null,
      artifactIds: notice.artifactIds,
      deliveryState: notice.deliveryState ?? 'dispatched',
      deliverAfter: notice.deliverAfter ?? null,
      createdAt: now,
      expiresAt: now + EXTENSION_RETENTION_MS,
    })
    .onConflictDoNothing({ target: [notifications.source, notifications.sourceId] })
    .returning()
    .get()
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
) {
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(notifications)
      .where(and(eq(notifications.source, 'outbox'), eq(notifications.sourceId, input.sourceId)))
      .get()
    if (existing) return existing

    if (input.urgency === 'immediate') {
      const inserted = recordNotification(
        tx,
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
      tx.update(notifications)
        .set({ deliveryState: 'dispatched', deliverAfter: now })
        .where(and(eq(notifications.source, 'outbox'), eq(notifications.deliveryState, 'pending')))
        .run()
      return inserted
    }

    const latest = tx
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.source, 'outbox'),
          inArray(notifications.deliveryState, ['dispatched', 'pending']),
        ),
      )
      .orderBy(desc(notifications.seq))
      .limit(1)
      .get()

    const inCooldown =
      latest !== undefined &&
      (latest.deliveryState === 'pending' || latest.createdAt > now - OUTBOX_PACING_WINDOW_MS)
    const deliverAfter = inCooldown
      ? latest.deliveryState === 'pending' && latest.deliverAfter !== null
        ? Math.max(now + 1, latest.deliverAfter)
        : latest.createdAt + OUTBOX_PACING_WINDOW_MS
      : now

    return recordNotification(
      tx,
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
  return db.transaction((tx) => {
    const due = tx
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.source, 'outbox'),
          eq(notifications.deliveryState, 'pending'),
          lte(notifications.deliverAfter, now),
        ),
      )
      .orderBy(asc(notifications.seq))
      .all()
    if (due.length === 0) return 0
    if (due.length === 1) {
      const only = due[0]
      if (!only) return 0
      tx.update(notifications)
        .set({ deliveryState: 'dispatched', deliverAfter: now })
        .where(eq(notifications.seq, only.seq))
        .run()
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
    tx.update(notifications)
      .set({
        summary: combinedSummary,
        details: combinedDetails,
        artifactIds,
        deliveryState: 'dispatched',
        deliverAfter: now,
      })
      .where(eq(notifications.seq, target.seq))
      .run()
    const suppressedSeqs = due.slice(0, -1).map((row) => row.seq)
    if (suppressedSeqs.length > 0) {
      tx.update(notifications)
        .set({ deliveryState: 'suppressed' })
        .where(inArray(notifications.seq, suppressedSeqs))
        .run()
    }
    return due.length
  })
}

/** Earliest pending outbox dispatch timestamp, if any. */
export function nextOutboxWake(db: LocalDb): number | undefined {
  return (
    db
      .select({ at: notifications.deliverAfter })
      .from(notifications)
      .where(and(eq(notifications.source, 'outbox'), eq(notifications.deliveryState, 'pending')))
      .orderBy(asc(notifications.deliverAfter))
      .limit(1)
      .get()?.at ?? undefined
  )
}

/** Recent dispatched outbox messages shown to the agent to avoid duplicate proactive alerts. */
export function recentOutboxSummaries(
  db: LocalDb,
  limit = 5,
): { seq: number; summary: string; createdAt: number }[] {
  return db
    .select({
      seq: notifications.seq,
      summary: notifications.summary,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(and(eq(notifications.source, 'outbox'), eq(notifications.deliveryState, 'dispatched')))
    .orderBy(desc(notifications.seq))
    .limit(limit)
    .all()
    .reverse()
}

/** Delete only inbox metadata; producers must insert exclusively on their first terminal transition. */
export function retainNotifications(db: LocalDb, now: number): void {
  db.delete(notifications).where(lte(notifications.expiresAt, now)).run()
}

/** The existing schedule alarm also removes unread or read metadata when its retention ends. */
export function nextNotificationExpiry(db: LocalDb): number | undefined {
  return db
    .select({ at: notifications.expiresAt })
    .from(notifications)
    .orderBy(asc(notifications.expiresAt))
    .limit(1)
    .get()?.at
}

/** List live notifications newest first, with explicit availability of the object-local result. */
export function listNotifications(db: LocalDb, query: unknown, now: number): NotificationPage {
  const input = parseInput(NotificationQuerySchema, query)
  retainNotifications(db, now)
  const rows = db
    .select({
      notification: notifications,
      schedule: { id: scheduledTaskOccurrences.id, settledAt: scheduledTaskOccurrences.settledAt },
      contact: {
        id: contactRequests.id,
        result: contactRequests.result,
        expiresAt: contactRequests.expiresAt,
      },
    })
    .from(notifications)
    .leftJoin(
      scheduledTaskOccurrences,
      and(
        eq(notifications.source, 'schedule'),
        eq(notifications.sourceId, scheduledTaskOccurrences.id),
      ),
    )
    .leftJoin(
      contactRequests,
      and(eq(notifications.source, 'contact'), eq(notifications.sourceId, contactRequests.id)),
    )
    .where(
      and(
        gt(notifications.expiresAt, now),
        eq(notifications.deliveryState, 'dispatched'),
        input.before === undefined ? undefined : lt(notifications.seq, input.before),
        input.unreadOnly ? isNull(notifications.readAt) : undefined,
      ),
    )
    .orderBy(desc(notifications.seq))
    .limit(input.limit + 1)
    .all()
  const page = rows.slice(0, input.limit)
  const last = page.at(-1)
  return {
    notifications: page.map(({ notification, schedule, contact }) => {
      const selfContained =
        notification.source === 'mcp' ||
        notification.source === 'outbox' ||
        notification.source === 'approval'
      const expiresAt =
        notification.source === 'schedule'
          ? schedule?.settledAt === null || schedule?.settledAt === undefined
            ? undefined
            : schedule.settledAt + EXTENSION_RETENTION_MS
          : selfContained
            ? notification.expiresAt
            : contact?.expiresAt
      const exists =
        selfContained || (notification.source === 'schedule' ? schedule !== null : contact !== null)
      const available =
        selfContained ||
        (notification.source === 'schedule' ? schedule?.settledAt != null : contact?.result != null)
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
    ...(rows.length > input.limit && last ? { nextBefore: last.notification.seq } : {}),
  }
}

/** Acknowledge only one live sequence; retries preserve the first server-generated timestamp. */
export function readNotification(db: LocalDb, seq: number, now: number): boolean {
  retainNotifications(db, now)
  db.update(notifications)
    .set({ readAt: now })
    .where(
      and(
        eq(notifications.seq, seq),
        isNull(notifications.readAt),
        gt(notifications.expiresAt, now),
      ),
    )
    .run()
  return (
    db
      .select({ seq: notifications.seq })
      .from(notifications)
      .where(and(eq(notifications.seq, seq), gt(notifications.expiresAt, now)))
      .get() !== undefined
  )
}
