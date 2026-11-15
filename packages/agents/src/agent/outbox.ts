/**
 * Outbox submission validation, burst pacing, and alarm-driven dispatch for a working agent.
 *
 * @see docs/extensions.md — Outbox
 * @module
 */
import * as v from 'valibot'
import type { ToolExecutionApi } from '@earendil-works/pi-durable'
import type { Context } from '@earendil-works/chord/context'
import type { LocalDb } from './local-db/local.ts'
import {
  dispatchDueOutbox,
  enqueueOutboxNotification,
  nextOutboxWake,
} from './local-db/notifications.ts'
import { setAlarm, setAlarmNoLaterThan } from './runtime/alarms.ts'
import { MAX_NOTIFICATION_SUMMARY_BYTES, MAX_OUTBOX_DETAILS_BYTES } from '../extensions.ts'
import type { OutboxCall } from '../tools/outbox.ts'

const encoder = new TextEncoder()

const OutboxCallSchema = v.strictObject({
  summary: v.pipe(
    v.string(),
    v.check((s) => s.trim().length > 0, 'Outbox summary cannot be blank'),
    v.check(
      (s) => encoder.encode(s).byteLength <= MAX_NOTIFICATION_SUMMARY_BYTES,
      'Outbox summary exceeds byte limit',
    ),
  ),
  details: v.optional(
    v.pipe(
      v.string(),
      v.check((s) => s.trim().length > 0, 'Outbox details cannot be blank'),
      v.check(
        (s) => encoder.encode(s).byteLength <= MAX_OUTBOX_DETAILS_BYTES,
        'Outbox details exceed byte limit',
      ),
    ),
  ),
  artifactIds: v.optional(
    v.pipe(v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(128))), v.maxLength(16)),
  ),
  urgency: v.optional(v.picklist(['normal', 'immediate'])),
})

/** Validate and enqueue an explicit outbox message, arming the outbox alarm when paced. */
export async function sendAgentOutbox(
  local: LocalDb,
  storage: DurableObjectStorage,
  api: Pick<ToolExecutionApi, 'taskId'>,
  context: Context,
  call: OutboxCall,
  checkAllowed: () => void,
): Promise<string> {
  context.abortSignal?.throwIfAborted()
  checkAllowed()
  const input = v.parse(OutboxCallSchema, call)
  const now = Date.now()
  await setAlarmNoLaterThan(storage, 'outbox', now + 60_000)
  context.abortSignal?.throwIfAborted()
  const row = enqueueOutboxNotification(
    local,
    {
      sourceId: `outbox-${api.taskId}`,
      summary: input.summary,
      ...(input.details === undefined ? {} : { details: input.details }),
      artifactIds: input.artifactIds ?? [],
      urgency: input.urgency ?? 'normal',
    },
    now,
  )
  await rearmOutbox(local, storage)
  return JSON.stringify({
    seq: row?.seq,
    deliveryState: row?.deliveryState ?? 'dispatched',
    deliverAfter: row?.deliverAfter ?? now,
  })
}

/** Flush any paced outbox messages whose delivery window has arrived and rearm the wake. */
export async function processOutbox(
  local: LocalDb,
  storage: DurableObjectStorage,
  now = Date.now(),
): Promise<number> {
  const dispatched = dispatchDueOutbox(local, now)
  await rearmOutbox(local, storage)
  return dispatched
}

/** Align the `outbox` alarm purpose with the earliest pending paced delivery. */
export function rearmOutbox(local: LocalDb, storage: DurableObjectStorage): Promise<void> {
  return setAlarm(storage, 'outbox', nextOutboxWake(local))
}
