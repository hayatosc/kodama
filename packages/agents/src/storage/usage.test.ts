/** Terminal idempotency, incomplete measurements and interrupted invocation recovery. @module */
import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import { usage } from '../../drizzle/durable-object/schema.ts'
import { newAgentId } from '../helper/management.ts'
import { openLocalDb } from './local.ts'
import {
  startUsage,
  finishUsage,
  interruptUsage,
  selectUsageCredential,
  usageSince,
  acknowledgeUsage,
} from './usage.ts'

const message: AssistantMessage = {
  role: 'assistant',
  content: [],
  api: 'openai-responses',
  provider: 'openai',
  model: 'gpt-4o-mini',
  timestamp: 1,
  stopReason: 'stop',
  usage: {
    input: 10,
    output: 5,
    cacheRead: 2,
    cacheWrite: 3,
    totalTokens: 20,
    reasoning: 2,
    cacheWrite1h: 1,
    cost: { input: 0.1, output: 0.2, cacheRead: 0.01, cacheWrite: 0.03, total: 0.34 },
  },
}

it('exports only a terminal prefix and prunes only thirty-day-old acknowledgments', async () => {
  const id = await newAgentId()
  await runInDurableObject(env.AGENTS.getByName(id), async (_, state) => {
    const local = await openLocalDb(state.storage)
    const start = () =>
      startUsage(
        local,
        { chargedAgentId: id, actorKind: 'user' },
        { provider: 'openai', id: 'gpt-4o-mini' },
      )
    const slow = start()
    const fast = start()
    finishUsage(local, fast, message)
    expect(usageSince(local, 0, 20)).toEqual({ rows: [], through: 0, more: true })
    expect(() => acknowledgeUsage(local, fast)).toThrow('unfinished')
    finishUsage(local, slow, message)
    expect(usageSince(local, 0, 1)).toMatchObject({ through: slow, more: true })
    expect(usageSince(local, 0, 20).rows).toHaveLength(2)
    acknowledgeUsage(local, slow, 100)
    acknowledgeUsage(local, slow, 100 + 30 * 86_400_000)
    expect(local.select().from(usage).all()).toHaveLength(2)
    acknowledgeUsage(local, slow, 101 + 30 * 86_400_000)
    expect(
      local
        .select()
        .from(usage)
        .all()
        .map((row) => row.seq),
    ).toEqual([fast])
    expect(usageSince(local, slow, 20).rows).toHaveLength(1)
  })
})

it('never double counts a terminal result or optional subset counters', async () => {
  const id = await newAgentId()
  await runInDurableObject(env.AGENTS.getByName(id), async (_, state) => {
    const local = await openLocalDb(state.storage)
    const seq = startUsage(
      local,
      { chargedAgentId: id, actorKind: 'user' },
      { provider: 'openai', id: 'gpt-4o-mini' },
    )
    selectUsageCredential(local, seq, { credentialId: 'credential', kind: 'oauth_subscription' })
    finishUsage(local, seq, message)
    finishUsage(local, seq, { ...message, stopReason: 'error' })
    const rows = local.select().from(usage).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      status: 'succeeded',
      totalTokens: 20,
      totalCost: 0.34,
      reasoning: 2,
      cacheWrite1h: 1,
      credentialKind: 'oauth_subscription',
    })
  })
})

it('keeps lost and ambiguous usage null and partial failures as lower bounds', async () => {
  const id = await newAgentId()
  await runInDurableObject(env.AGENTS.getByName(id), async (_, state) => {
    const local = await openLocalDb(state.storage)
    const start = () =>
      startUsage(
        local,
        { chargedAgentId: id, actorKind: 'system' },
        { provider: 'openai', id: 'gpt-4o-mini' },
      )
    start()
    interruptUsage(local)
    const zero = start()
    selectUsageCredential(local, zero, { credentialId: 'credential', kind: 'api_key' })
    finishUsage(local, zero, {
      ...message,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    })
    const partial = start()
    finishUsage(local, partial, {
      ...message,
      stopReason: 'error',
      errorMessage: 'rate_limit: secret must not persist',
    })
    const rows = local.select().from(usage).all()
    expect(rows[0]).toMatchObject({
      status: 'interrupted',
      usageState: 'unknown',
      totalTokens: null,
      totalCost: null,
    })
    expect(rows[1]).toMatchObject({
      status: 'succeeded',
      usageState: 'unknown',
      totalTokens: null,
      totalCost: null,
    })
    expect(rows[2]).toMatchObject({
      status: 'failed',
      usageState: 'partial',
      rateLimited: true,
      totalTokens: 20,
    })
    expect(JSON.stringify(rows)).not.toContain('secret must not persist')
    local.delete(usage).run()
    expect(start()).toBeGreaterThan(partial)
  })
})
