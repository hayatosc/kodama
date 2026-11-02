/** Idempotent completion inserts that can share the producer's SQLite transaction.
 * @see docs/extensions.md — Completion and notification atomicity
 * @module
 */
import { and, asc, desc, eq, gt, isNull, lt, lte } from 'drizzle-orm'
import {
  contactRequests,
  notifications,
  scheduledTaskOccurrences,
} from '../../../drizzle/durable-object/schema.ts'
import { EXTENSION_RETENTION_MS, MAX_NOTIFICATION_SUMMARY_BYTES } from '../../extensions.ts'
import type { CompletionNotice, NotificationPage } from '../../extensions.ts'
import { NotificationQuerySchema, parseInput } from '../../validation.ts'
import type { LocalDb } from './local.ts'

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
    notice.artifactIds.length > 16 ||
    notice.artifactIds.some((id) => id.length === 0 || id.length > 128)
  )
    throw new TypeError('Invalid notification artifact references')
  return db
    .insert(notifications)
    .values({ ...notice, createdAt: now, expiresAt: now + EXTENSION_RETENTION_MS })
    .onConflictDoNothing({ target: [notifications.source, notifications.sourceId] })
    .returning()
    .get()
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
      const expiresAt =
        notification.source === 'schedule'
          ? schedule?.settledAt === null || schedule?.settledAt === undefined
            ? undefined
            : schedule.settledAt + EXTENSION_RETENTION_MS
          : contact?.expiresAt
      const exists = notification.source === 'schedule' ? schedule !== null : contact !== null
      const available =
        notification.source === 'schedule' ? schedule?.settledAt != null : contact?.result != null
      return {
        ...notification,
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
