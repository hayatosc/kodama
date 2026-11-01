/** Idempotent completion inserts that can share the producer's SQLite transaction.
 * @see docs/extensions.md — Completion and notification atomicity
 * @module
 */
import { notifications } from '../../../drizzle/durable-object/schema.ts'
import { EXTENSION_RETENTION_MS, MAX_NOTIFICATION_SUMMARY_BYTES } from '../../extensions.ts'
import type { CompletionNotice } from '../../extensions.ts'
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
