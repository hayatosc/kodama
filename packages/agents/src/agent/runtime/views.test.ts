/** Attention is a read-only projection of real Pi waits and durable peer state. @module */
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { afterEach, expect, it, vi } from 'vitest'
import { withHarness } from '../../testing/harness.ts'
import { openLocalDb } from '../local-db/local.ts'
import { acceptContact, reserveContact } from '../local-db/contacts.ts'
import { attentionOf } from './views.ts'
import '@earendil-works/pi-ai/api/openai-responses'

afterEach(() => vi.restoreAllMocks())

it('reports an actual model retry wait and exposes only the existing cancel action', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () =>
      new Response(
        JSON.stringify({ error: { message: 'Rate limited', type: 'rate_limit_error' } }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      ),
  )
  await withHarness(
    { retry: { enabled: true, maxRetries: 10, baseDelayMs: 30_000, maxAgentDelayMs: 30_000 } },
    async (harness, state) => {
      const db = await openLocalDb(state.storage)
      const root = await harness.root(BACKGROUND_CONTEXT)
      await root.submit(
        { type: 'input', requestId: 'retry-attention', content: 'Hello' },
        BACKGROUND_CONTEXT,
      )
      await expect
        .poll(
          async () =>
            (await attentionOf(harness, db)).find((item) => item.source === 'execution')?.reason,
        )
        .toBe('model_retry_wait')
      const item = (await attentionOf(harness, db)).find((entry) => entry.source === 'execution')
      expect(item?.actions).toEqual(['cancel'])
      expect(item).not.toHaveProperty('nextRetryAt')
      await root.abort(BACKGROUND_CONTEXT)
      expect(
        (await attentionOf(harness, db)).filter((entry) => entry.source === 'execution'),
      ).toEqual([])
    },
  )
})

it('reports dispatch and result waits without changing peer state', async () => {
  await withHarness({}, async (harness, state) => {
    const db = await openLocalDb(state.storage)
    const pending = reserveContact(
      db,
      {
        sourceTask: 'attention-task',
        sourceEntry: 1,
        arguments: '{}',
        targetAgentId: 'peer',
        content: 'Hello',
        hop: 1,
      },
      100,
    )
    expect(await attentionOf(harness, db)).toContainEqual({
      source: 'contact',
      id: pending.id,
      reason: 'contact_delivery_wait',
      lastProgressAt: 100,
      actions: [],
    })
    acceptContact(db, pending.id, 1, 200)
    expect(await attentionOf(harness, db)).toContainEqual({
      source: 'contact',
      id: pending.id,
      reason: 'contact_result_wait',
      lastProgressAt: 100,
      actions: [],
    })
  })
})
