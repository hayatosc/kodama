/** Terminal idempotency, incomplete measurements and interrupted invocation recovery. @module */
import { evictDurableObject, runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import { eq } from 'drizzle-orm'
import { auditLog, usageDaily } from '../../drizzle/management/schema.ts'
import { ingestUsage } from '../management/usage.ts'
import { managementDb } from '../management/db.ts'
import { admitWeb } from './external-data.ts'
import { finishSearchAttempt, searchProviderState, startSearchAttempt } from './web-search.ts'
import { usage } from '../../drizzle/durable-object/schema.ts'
import { newAgentId } from '../helper/management.ts'
import { openLocalDb } from './local.ts'
import {
  startUsage,
  startToolUsage,
  finishUsage,
  interruptUsage,
  selectUsageCredential,
  usageSince,
  acknowledgeUsage,
} from './usage.ts'

it('recovers ordered 429 and pending attempts after eviction and ingests their audit exactly once', async () => {
  const id = await newAgentId()
  const stub = env.AGENTS.getByName(id)
  const until = Date.now() + 86_400_000
  await runInDurableObject(stub, async (_instance, state) => {
    const local = await openLocalDb(state.storage)
    const seq = startToolUsage(
      local,
      { chargedAgentId: id, actorKind: 'user' },
      'interrupted-search',
      'web_search',
    )
    admitWeb(local, {
      seq,
      root: 'root',
      run: 'run',
      inputs: [],
      tool: 'web_search',
      argument: 'q',
      keyless: true,
      eligibleThrough: 0,
    })
    startSearchAttempt(local, seq, 'exa')
    finishSearchAttempt(
      local,
      seq,
      {
        provider: 'exa',
        startedAt: Date.now(),
        finishedAt: Date.now(),
        status: 429,
        reason: 'rate_limited',
        cooldown: until,
        bytes: 7,
      },
      { blockedUntil: until, consecutive429: 1 },
    )
    startSearchAttempt(local, seq, 'firecrawl')
  })
  await evictDurableObject(stub)
  const page = await stub.usageSince(0, 20)
  expect(page.rows).toMatchObject([
    {
      status: 'interrupted',
      searchCount: 2,
      countKind: 'provider_requests',
      httpCount: 2,
      receivedBytes: null,
    },
  ])
  const audit = page.rows[0]?.auditJson
  if (!audit) throw new Error('Missing recovered audit')
  const parsed: unknown = JSON.parse(audit)
  expect(parsed).toMatchObject({
    status: 'interrupted',
    attempts: [
      expect.stringContaining('"status":429'),
      expect.stringContaining('"reason":"interrupted"'),
    ],
  })
  expect(audit).toContain('\\"bytes\\":7')
  expect(audit).toContain('\\"bytes\\":null')
  expect(audit).toContain(String(until))
  await runInDurableObject(stub, async (_instance, state) => {
    expect(searchProviderState(await openLocalDb(state.storage), 'exa')?.blockedUntil).toBe(until)
  })
  const db = managementDb(env.MANAGEMENT_DB)
  await Promise.all([
    ingestUsage(db, id, 0, page, Date.now()),
    ingestUsage(db, id, 0, page, Date.now()),
  ])
  await ingestUsage(db, id, 0, page, Date.now())
  const audits = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.opId, `tool:${id}:1`))
  expect(audits).toHaveLength(1)
  expect(audits[0]?.detailJson).toBe(audit)
  expect(await db.select().from(usageDaily).where(eq(usageDaily.chargedAgentId, id))).toMatchObject(
    [{ attempts: 1, searchCount: 2, httpCount: 2, receivedBytes: null }],
  )
})

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
