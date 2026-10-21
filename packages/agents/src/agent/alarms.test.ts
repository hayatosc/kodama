import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AlarmSchedule } from './alarms.ts'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'

afterEach(() => vi.restoreAllMocks())

describe('alarm schedule', () => {
  it('keeps one alarm at the earliest purpose and clears only the purpose it is told to', async () => {
    const stub = env.AGENTS.getByName(crypto.randomUUID())
    const now = Date.now()

    const alarms = await runInDurableObject(stub, async (_instance, state) => {
      const schedule = new AlarmSchedule(state.storage)
      await schedule.set('extract', now + 100_000)
      await schedule.set('recovery', now + 50_000)
      const both = await state.storage.getAlarm()
      await schedule.set('recovery', undefined)
      const extractOnly = await state.storage.getAlarm()
      const taken = await schedule.take(now + 100_000)
      return { both, extractOnly, taken, after: await state.storage.getAlarm() }
    })

    expect(alarms).toEqual({
      both: now + 50_000,
      extractOnly: now + 100_000,
      taken: ['extract'],
      after: null,
    })
  })
})
