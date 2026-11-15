/**
 * Durable event inbox: fast-ack RPC ingestion, `requestId` deduplication, burst coalescing,
 * `sessionMode: 'new'` isolation, and `whenBusy: 'interrupt'`.
 *
 * @module
 */
import { runInDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vite-plus/test'
import { eventInbox } from '../../drizzle/durable-object/schema.ts'
import { openLocalDb } from './local-db/local.ts'
import { setAlarm } from './runtime/alarms.ts'
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
    expect(fetch).toHaveBeenCalledTimes(1)

    await runInDurableObject(env.AGENTS.getByName(id), async (_instance, state) => {
      const local = await openLocalDb(state.storage)
      const rows = local.select().from(eventInbox).all()
      expect(rows.every((row) => row.state === 'admitted')).toBe(true)
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
})
