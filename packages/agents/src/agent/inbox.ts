/**
 * Alarm-driven event inbox dispatcher: drains queued events, coalesces bursts, isolates
 * `sessionMode: 'new'` sessions via `root.reset()` when idle, and handles `whenBusy: 'interrupt'`.
 *
 * @see docs/agents.md — Event inbox
 * @module
 */
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Harness, SubmissionDraft } from '@earendil-works/pi-durable'
import type { InboxEventSource } from '../protocol.ts'
import type { LocalDb } from './local-db/local.ts'
import {
  coalesceInboxBatch,
  nextInboxWake,
  pendingInboxEvents,
  markInboxAdmitted,
  retainInbox,
  retryInboxBatch,
  settleInboxEvents,
} from './local-db/inbox.ts'
import { setAlarm, setAlarmNoLaterThan } from './runtime/alarms.ts'
import { isIdle } from './runtime/harness.ts'
import { submissionOf } from './runtime/views.ts'
import { latestEntryId } from '../memory/transcript.ts'

const context = BACKGROUND_CONTEXT

/** Arm the `inbox` alarm before admitting work so a crash before dispatch still recovers. */
export function armInbox(storage: DurableObjectStorage): Promise<void> {
  return setAlarmNoLaterThan(storage, 'inbox', Date.now() + 60_000)
}

/** Align the `inbox` alarm purpose with the earliest retry or retention deadline. */
export async function rearmInbox(local: LocalDb, storage: DurableObjectStorage): Promise<void> {
  retainInbox(local, Date.now())
  await setAlarm(storage, 'inbox', nextInboxWake(local))
}

function permanentInboxRefusal(error: unknown): boolean {
  return (
    error instanceof Error &&
    /^(agent_restricted|agent_unavailable:|Unknown agent:|credential_unavailable:.*(?:needs_reauth|no usable assigned credential|missing|not granted|revoked|disabled))/.test(
      error.message,
    )
  )
}

/** Drain due queued events into Pi with coalescing, session isolation, and retry backoff. */
export async function dispatchInbox(
  local: LocalDb,
  harness: Harness,
  storage: DurableObjectStorage,
  serialize: <T>(operation: () => Promise<T>) => Promise<T>,
  prepare: (source: InboxEventSource) => Promise<void>,
  admit: (
    draft: SubmissionDraft,
    actorKind: 'user' | 'agent' | 'system',
  ) => Promise<{ id: number }>,
): Promise<void> {
  for (let round = 0; round < 5; round++) {
    const batch = await serialize(async () => {
      retainInbox(local, Date.now())
      return coalesceInboxBatch(pendingInboxEvents(local, Date.now()))
    })
    if (!batch) break
    const ids = batch.batch.map((row) => row.id)
    try {
      const existing = await submissionOf(harness, batch.requestId)
      if (existing) {
        await serialize(async () => {
          markInboxAdmitted(local, ids, existing.id, Date.now())
        })
        continue
      }

      if (batch.whenBusy === 'interrupt' && !(await isIdle(harness))) {
        const root = await harness.root(context)
        await root.abort(context)
      }

      if (batch.sessionMode === 'new') {
        if (!(await isIdle(harness))) {
          // Wait until the active session finishes before isolating a fresh session context.
          await setAlarmNoLaterThan(storage, 'inbox', Date.now() + 5_000)
          return
        }
        if ((await latestEntryId(harness)) !== undefined) {
          const root = await harness.root(context)
          await root.reset(undefined, context)
        }
      }

      await prepare(batch.primarySource)
      const actorKind: 'user' | 'agent' | 'system' =
        batch.primarySource === 'user'
          ? 'user'
          : batch.primarySource === 'peer'
            ? 'agent'
            : 'system'
      const draft: SubmissionDraft = {
        type: 'input',
        requestId: batch.requestId,
        whenBusy: batch.whenBusy === 'interrupt' ? 'followUp' : batch.whenBusy,
        content: batch.content,
        entry:
          batch.primarySource === 'user'
            ? { kind: 'kodama.operator-message' }
            : {
                kind: 'kodama.event-message',
                data: { source: batch.primarySource, count: batch.batch.length },
              },
      }
      const submission = await admit(draft, actorKind)
      await serialize(async () => {
        markInboxAdmitted(local, ids, submission.id, Date.now())
      })
    } catch (error) {
      await serialize(async () => {
        const accepted = await submissionOf(harness, batch.requestId)
        if (accepted) {
          markInboxAdmitted(local, ids, accepted.id, Date.now())
          return
        }
        if (permanentInboxRefusal(error)) {
          settleInboxEvents(local, ids, Date.now())
        } else {
          retryInboxBatch(local, batch.batch, Date.now())
        }
      })
      break
    }
  }
  await serialize(() => rearmInbox(local, storage))
}
