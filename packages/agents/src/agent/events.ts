import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { ROOT_CONVERSATION_ID, watchEvents } from '@earendil-works/pi-durable'
import type {
  AgentEvent,
  AgentEventStream,
  Harness,
  SubmissionRecord,
} from '@earendil-works/pi-durable'
import type { AgentSendEvent } from '../protocol.ts'

const context = BACKGROUND_CONTEXT

type Delivery = { events: readonly AgentSendEvent[]; close?: boolean }

function isSettled(record: SubmissionRecord | undefined): record is SubmissionRecord {
  return record?.status === 'done' || record?.status === 'unanswered'
}

/** One observer per byte stream; cancellation releases only that observer. */
function eventStream(
  watch: AgentEventStream,
  initial: Delivery,
  select: (event: AgentEvent) => Promise<Delivery>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let ended = false
  let demand = false
  let wake: (() => void) | undefined
  return new ReadableStream({
    type: 'bytes',
    start(controller) {
      const deliver = async ({ events, close }: Delivery) => {
        for (const event of events) {
          if (!demand && !ended)
            await new Promise<void>((resolve) => {
              wake = resolve
            })
          if (ended) return
          demand = false
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
          )
        }
        if (close) void watch.stop()
      }
      // Pi bounds pending batches, replacing an overflowing backlog with a snapshot.
      const opening = deliver(initial)
      watch.start(async (events) => {
        await opening
        for (const event of events) {
          if (ended) return
          const delivery = await select(event)
          await deliver(delivery)
          if (delivery.close) return
        }
      })
      void opening.catch(() => watch.stop())
      void watch.closed.then((end) => {
        if (ended) return
        ended = true
        wake?.()
        if (end.reason === 'session_failed' || end.reason === 'listener_error') {
          controller.error(new Error('Agent event subscription failed'))
        } else controller.close()
      })
    },
    pull() {
      demand = true
      wake?.()
      wake = undefined
    },
    async cancel() {
      ended = true
      wake?.()
      await watch.stop()
    },
  })
}

export async function subscribeEvents(harness: Harness): Promise<ReadableStream<Uint8Array>> {
  const watch = await watchEvents(harness, ROOT_CONVERSATION_ID, context)
  return eventStream(watch, { events: [watch.snapshot] }, async (event) => ({ events: [event] }))
}

/** Attach before admission so even a fast generation cannot outrun its observer. */
export async function sendEvents(
  harness: Harness,
  requestId: string,
  admit: () => Promise<number>,
): Promise<ReadableStream<Uint8Array>> {
  let watch = await watchEvents(harness, ROOT_CONVERSATION_ID, context)
  const receipt = () =>
    harness.commit((tx) => tx.submissionByRequest(ROOT_CONVERSATION_ID, requestId), context)
  try {
    const submissionId = await admit()
    const existing = await receipt()
    const settled = isSettled(existing)
    if (settled) {
      // A retry or very fast response needs a snapshot taken after the terminal commit.
      await watch.stop()
      watch = await watchEvents(harness, ROOT_CONVERSATION_ID, context)
    }
    let active = watch.snapshot.run?.inputs.some((id) => id === submissionId) ?? false
    const initial: AgentSendEvent[] = [
      { type: 'accepted', requestId, submissionId },
      watch.snapshot,
    ]
    if (settled) initial.push({ type: 'submission', record: existing })
    return eventStream(watch, { events: initial, close: settled }, async (event) => {
      if (event.type === 'snapshot') {
        active = event.run?.inputs.some((id) => id === submissionId) ?? false
        // Overflow may have replaced the terminal notification; recover it from storage.
        const current = await receipt()
        if (isSettled(current)) {
          const latest = await watchEvents(harness, ROOT_CONVERSATION_ID, context)
          try {
            return {
              events: [latest.snapshot, { type: 'submission', record: current }],
              close: true,
            }
          } finally {
            await latest.stop()
          }
        }
        return { events: [event] }
      }
      if (event.type === 'submission') {
        return event.record.id === submissionId
          ? {
              events: [event],
              close: isSettled(event.record),
            }
          : { events: [] }
      }
      if (event.type === 'run_start') active = event.inputs.some((id) => id === submissionId)
      const include = active && event.type !== 'inbox_update' && event.type !== 'agent_changed'
      if (event.type === 'run_end') active = false
      return { events: include ? [event] : [] }
    })
  } catch (error) {
    await watch.stop()
    throw error
  }
}
