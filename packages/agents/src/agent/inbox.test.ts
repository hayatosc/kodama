/**
 * Durable event inbox: fast-ack RPC ingestion, `requestId` deduplication, burst coalescing,
 * `sessionMode: 'new'` isolation, and `whenBusy: 'interrupt'`.
 *
 * @module
 */
import { ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { runInDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vite-plus/test'
import { eventInbox } from '../../drizzle/durable-object/schema.ts'
import { dispatchInbox } from './inbox.ts'
import { isKnownUrl } from './local-db/external-data.ts'
import { enqueueInboxEvent, reserveInboxBatch } from './local-db/inbox.ts'
import { openLocalDb } from './local-db/local.ts'
import { setAlarm } from './runtime/alarms.ts'
import { withHarness } from '../testing/harness.ts'
import { newAgentId, updateSettings } from '../testing/management.ts'
import { requestBody, textResponse } from '../testing/model.ts'
import { useMockModel, waitForAnswer } from '../testing/rpc.ts'
import '@earendil-works/pi-ai/api/openai-responses'

useMockModel()

async function wakeInbox(id: string) {
  await runInDurableObject(env.AGENTS.getByName(id), async (instance, state) => {
    await setAlarm(state.storage, 'inbox', Date.now() - 1)
    await instance.alarm()
  })
}

describe('event inbox', () => {
  it('fast-acks into event_inbox, deduplicates requestId, and coalesces bursts into one turn', async () => {
    const id = await newAgentId()
    await updateSettings(id, { memoryPolicy: { remember: true, extract: false } })

    const first = await exports.default.ingestEvent(id, {
      requestId: 'wh-1',
      source: 'webhook',
      content: 'CI workflow failed on main',
      metadata: { label: 'github' },
    })
    const replay = await exports.default.ingestEvent(id, {
      requestId: 'wh-1',
      source: 'webhook',
      content: 'CI workflow failed on main',
      metadata: { label: 'github' },
    })
    const second = await exports.default.ingestEvent(id, {
      requestId: 'wh-2',
      source: 'webhook',
      content: 'Deploy preview failed',
      metadata: { label: 'cloudflare' },
    })

    expect(first).toEqual({
      agentId: id,
      eventId: first.eventId,
      requestId: 'wh-1',
      queued: true,
    })
    expect(replay.eventId).toBe(first.eventId)
    expect(second.eventId).not.toBe(first.eventId)
    // Ingestion itself must not invoke the model synchronously.
    expect(fetch).not.toHaveBeenCalled()

    await runInDurableObject(env.AGENTS.getByName(id), async (_instance, state) => {
      const local = await openLocalDb(state.storage)
      expect(local.select().from(eventInbox).all()).toHaveLength(2)
    })

    vi.mocked(fetch).mockImplementationOnce(async (_input, init) => {
      const body = requestBody(init)
      expect(body).toContain('[Coalesced 2 queued events]')
      expect(body).toContain('CI workflow failed on main')
      expect(body).toContain('Deploy preview failed')
      return textResponse('Handled both webhook events.')
    })

    await wakeInbox(id)
    await waitForAnswer(id, 'wh-1')
    await waitForAnswer(id, 'wh-2')
    using secondSubmission = await exports.default.submission(id, 'wh-2')
    expect(secondSubmission?.submission.status).toBe('done')
    expect(fetch).toHaveBeenCalledTimes(1)

    await runInDurableObject(env.AGENTS.getByName(id), async (_instance, state) => {
      const local = await openLocalDb(state.storage)
      const rows = local.select().from(eventInbox).all()
      expect(rows.every((row) => row.state === 'admitted')).toBe(true)
    })
  })

  it('keeps user events and external webhook events in separate batches and trust origins', async () => {
    const id = await newAgentId()
    await updateSettings(id, { memoryPolicy: { remember: true, extract: false } })

    await exports.default.ingestEvent(id, {
      requestId: 'mix-user-1',
      source: 'user',
      content: 'Read https://example.org/user-approved',
    })
    await exports.default.ingestEvent(id, {
      requestId: 'mix-webhook-1',
      source: 'webhook',
      content: 'Untrusted webhook payload https://example.org/webhook-untrusted',
    })

    const observedBodies: string[] = []
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      observedBodies.push(requestBody(init))
      return textResponse(`Handled batch ${observedBodies.length}.`)
    })

    await wakeInbox(id)
    await waitForAnswer(id, 'mix-user-1')
    await waitForAnswer(id, 'mix-webhook-1')

    expect(observedBodies).toHaveLength(2)
    expect(observedBodies[0]).toContain('https://example.org/user-approved')
    expect(observedBodies[0]).not.toContain('webhook-untrusted')
    expect(observedBodies[1]).toContain('https://example.org/webhook-untrusted')

    await runInDurableObject(env.AGENTS.getByName(id), async (_instance, state) => {
      const local = await openLocalDb(state.storage)
      expect(
        isKnownUrl(local, String(ROOT_CONVERSATION_ID), 'https://example.org/user-approved'),
      ).toBe(true)
      expect(
        isKnownUrl(local, String(ROOT_CONVERSATION_ID), 'https://example.org/webhook-untrusted'),
      ).toBe(false)
    })
  })

  it('recovers reserved batch membership without absorbing later queued events', async () => {
    await withHarness({}, async (harness, state) => {
      const local = await openLocalDb(state.storage)
      const now = Date.now()
      enqueueInboxEvent(
        local,
        {
          requestId: 'crash-ev-a',
          source: 'webhook',
          sessionMode: 'resume',
          whenBusy: 'followUp',
          content: 'Event A',
        },
        now - 20,
      )
      // Simulate reserving A before Pi accepts A, then crashing before markInboxAdmitted runs.
      const reserved = reserveInboxBatch(local, now - 20)
      expect(reserved?.requestId).toBe('crash-ev-a')
      const root = await harness.root(BACKGROUND_CONTEXT)
      const subA = await root.submit(
        { type: 'input', requestId: 'crash-ev-a', content: 'Event A' },
        BACKGROUND_CONTEXT,
      )
      // Event B arrives before recovery runs, already due so recovery does not depend on wall time.
      enqueueInboxEvent(
        local,
        {
          requestId: 'crash-ev-b',
          source: 'webhook',
          sessionMode: 'resume',
          whenBusy: 'followUp',
          content: 'Event B',
        },
        now - 10,
      )

      const admittedDrafts: string[] = []
      const submitted: Promise<unknown>[] = []
      try {
        await dispatchInbox(
          local,
          harness,
          state.storage,
          (operation) => operation(),
          async () => {},
          async (draft) => {
            if (draft.requestId) admittedDrafts.push(draft.requestId)
            const submission = await root.submit(draft, BACKGROUND_CONTEXT)
            submitted.push(submission.wait(BACKGROUND_CONTEXT))
            return submission
          },
        )

        expect(admittedDrafts).toEqual(['crash-ev-b'])
        const rows = local.select().from(eventInbox).all()
        expect(rows).toHaveLength(2)
        expect(rows.every((row) => row.state === 'admitted')).toBe(true)
        expect(rows.find((row) => row.requestId === 'crash-ev-b')?.batchRequestId).toBe(
          'crash-ev-b',
        )
      } finally {
        await Promise.allSettled([subA.wait(BACKGROUND_CONTEXT), ...submitted])
        await state.storage.deleteAlarm()
      }
    })
  })

  it('isolates sessionMode new via root.reset() while keeping older entries for memory extraction', async () => {
    const id = await newAgentId()
    await updateSettings(id, { memoryPolicy: { remember: true, extract: false } })

    vi.mocked(fetch).mockImplementationOnce(async () => textResponse('Noted alpha-secret-42.'))
    await exports.default.sendMessage(id, {
      requestId: 'user-prior',
      content: 'Remember alpha-secret-42 for later.',
    })
    await waitForAnswer(id, 'user-prior')

    await exports.default.ingestEvent(id, {
      requestId: 'ev-new-session',
      source: 'webhook',
      sessionMode: 'new',
      content: 'Run isolated audit check.',
    })

    vi.mocked(fetch).mockImplementationOnce(async (_input, init) => {
      const body = requestBody(init)
      expect(body).toContain('Run isolated audit check.')
      expect(body).not.toContain('alpha-secret-42')
      return textResponse('Audit isolated.')
    })

    await wakeInbox(id)
    await waitForAnswer(id, 'ev-new-session')

    // Prior entries remain in Pi storage so memory extraction still sees the full transcript.
    await runInDurableObject(env.AGENTS.getByName(id), async (instance) => {
      const page = await instance.readEntries({ after: 0, limit: 50 })
      const joined = page.entries.map((entry) => entry.text).join('\n')
      expect(joined).toContain('alpha-secret-42')
      expect(joined).toContain('Audit isolated.')
    })
  })

  it('aborts an active slow turn when an event or message specifies whenBusy interrupt', async () => {
    const id = await newAgentId()
    await updateSettings(id, { memoryPolicy: { remember: true, extract: false } })

    const started = Promise.withResolvers<void>()
    const slowFinish = Promise.withResolvers<Response>()
    vi.mocked(fetch)
      .mockImplementationOnce(async (_input, init) => {
        started.resolve()
        if (init?.signal) {
          const signal = init.signal
          if (signal.aborted) throw signal.reason
          return Promise.race([
            slowFinish.promise,
            new Promise<Response>((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(signal.reason), { once: true })
            }),
          ])
        }
        return slowFinish.promise
      })
      .mockImplementationOnce(async () => textResponse('Urgent interrupt handled.'))

    try {
      await exports.default.sendMessage(id, {
        requestId: 'slow-turn',
        content: 'Do slow research.',
      })
      await started.promise

      await exports.default.ingestEvent(id, {
        requestId: 'urgent-ev',
        source: 'webhook',
        whenBusy: 'interrupt',
        content: 'URGENT: cancel old work and handle outage.',
      })
      await wakeInbox(id)
      await waitForAnswer(id, 'urgent-ev')

      using slowStatus = await exports.default.submission(id, 'slow-turn')
      expect(slowStatus?.submission.status).toBe('unanswered')
    } finally {
      slowFinish.resolve(textResponse('Late'))
    }
  })

  it('aborts an active turn when direct sendMessage specifies whenBusy interrupt', async () => {
    const id = await newAgentId()
    await updateSettings(id, { memoryPolicy: { remember: true, extract: false } })

    const started = Promise.withResolvers<void>()
    const slowFinish = Promise.withResolvers<Response>()
    vi.mocked(fetch)
      .mockImplementationOnce(async (_input, init) => {
        started.resolve()
        if (init?.signal) {
          const signal = init.signal
          if (signal.aborted) throw signal.reason
          return Promise.race([
            slowFinish.promise,
            new Promise<Response>((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(signal.reason), { once: true })
            }),
          ])
        }
        return slowFinish.promise
      })
      .mockImplementationOnce(async () => textResponse('Stopped and switched.'))

    try {
      await exports.default.sendMessage(id, {
        requestId: 'long-chat',
        content: 'Long running turn.',
      })
      await started.promise

      await exports.default.sendMessage(id, {
        requestId: 'interrupt-chat',
        whenBusy: 'interrupt',
        content: 'Stop that and answer this instead.',
      })
      await waitForAnswer(id, 'interrupt-chat')

      using longStatus = await exports.default.submission(id, 'long-chat')
      expect(longStatus?.submission.status).toBe('unanswered')
    } finally {
      slowFinish.resolve(textResponse('Late'))
    }
  })

  it('deduplicates concurrent same-requestId interrupt calls without aborting the replacement turn', async () => {
    const id = await newAgentId()
    await updateSettings(id, { memoryPolicy: { remember: true, extract: false } })

    const oldStarted = Promise.withResolvers<void>()
    const oldFinish = Promise.withResolvers<Response>()
    const replacementStarted = Promise.withResolvers<void>()
    const replacementFinish = Promise.withResolvers<Response>()

    vi.mocked(fetch)
      .mockImplementationOnce(async (_input, init) => {
        oldStarted.resolve()
        if (init?.signal) {
          const signal = init.signal
          if (signal.aborted) throw signal.reason
          return Promise.race([
            oldFinish.promise,
            new Promise<Response>((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(signal.reason), { once: true })
            }),
          ])
        }
        return oldFinish.promise
      })
      .mockImplementationOnce(async (_input, init) => {
        replacementStarted.resolve()
        if (init?.signal) {
          const signal = init.signal
          if (signal.aborted) throw signal.reason
          return Promise.race([
            replacementFinish.promise,
            new Promise<Response>((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(signal.reason), { once: true })
            }),
          ])
        }
        return replacementFinish.promise
      })

    try {
      await exports.default.sendMessage(id, {
        requestId: 'old-slow',
        content: 'Old slow work.',
      })
      await oldStarted.promise

      const [sub1, sub2] = await Promise.all([
        exports.default.sendMessage(id, {
          requestId: 'dup-interrupt',
          whenBusy: 'interrupt',
          content: 'Replacement request.',
        }),
        exports.default.sendMessage(id, {
          requestId: 'dup-interrupt',
          whenBusy: 'interrupt',
          content: 'Replacement request.',
        }),
      ])
      expect(sub1).toStrictEqual(sub2)
      await replacementStarted.promise
      replacementFinish.resolve(textResponse('Replacement succeeded.'))
      await waitForAnswer(id, 'dup-interrupt')

      using dupStatus = await exports.default.submission(id, 'dup-interrupt')
      expect(dupStatus?.submission.status).toBe('done')
      using oldStatus = await exports.default.submission(id, 'old-slow')
      expect(oldStatus?.submission.status).toBe('unanswered')
    } finally {
      oldFinish.resolve(textResponse('Late old'))
      replacementFinish.resolve(textResponse('Late replacement'))
    }
  })
})
