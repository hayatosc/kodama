/** Usage-owned attempt ordering, cooldown/session retention, and recovery across eviction. @module */
import { evictDurableObject, runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import { usage } from '../../../drizzle/durable-object/schema.ts'
import { newAgentId } from '../../testing/management.ts'
import { openLocalDb } from './local.ts'
import type { LocalDb } from './local.ts'
import { acknowledgeUsage, finishToolUsage, usageSince } from './usage.ts'
import {
  finishSearchAttempt,
  saveSearchSession,
  searchAttempts,
  searchProviderState,
  searchSession,
  startSearchAttempt,
} from './web-search.ts'

const day = 86_400_000

function start(local: LocalDb, agentId: string, task: string, now: number): number {
  return local
    .insert(usage)
    .values({
      kind: 'tool',
      tool: 'web_search',
      keyless: true,
      task,
      startedAt: now,
      chargedAgentId: agentId,
      actorKind: 'user',
      admittedAt: now,
    })
    .returning({ seq: usage.seq })
    .get().seq
}

it('owns ordered attempts and final answering provider on one usage row without auditing the session', async () => {
  const id = await newAgentId()
  await runInDurableObject(env.AGENTS.getByName(id), async (_agent, state) => {
    const local = await openLocalDb(state.storage)
    const now = Date.now()
    const seq = start(local, id, 'ordered', now)
    startSearchAttempt(local, seq, 'exa', now)
    finishSearchAttempt(
      local,
      seq,
      {
        provider: 'exa',
        startedAt: now,
        finishedAt: now,
        status: 429,
        reason: 'rate_limited',
        cooldown: now + day,
        bytes: 3,
      },
      { blockedUntil: now + day, consecutive429: 1 },
    )
    startSearchAttempt(local, seq, 'parallel', now)
    finishSearchAttempt(
      local,
      seq,
      {
        provider: 'parallel',
        startedAt: now,
        finishedAt: now,
        status: 200,
        reason: 'succeeded',
        cooldown: null,
        bytes: 7,
      },
      { blockedUntil: 0, consecutive429: 0 },
    )
    saveSearchSession(local, seq, 'private-session')
    finishToolUsage(local, seq, 'succeeded')
    expect(local.select().from(usage).all()).toHaveLength(1)
    expect(searchAttempts(local, seq)).toMatchObject([
      { provider: 'exa', status: 429 },
      { provider: 'parallel', status: 200 },
    ])
    const row = usageSince(local, 0, 20).rows[0]
    expect(row).toMatchObject({
      provider: 'parallel',
      status: 'succeeded',
      searchCount: 2,
      httpCount: 2,
      receivedBytes: 10,
    })
    expect(row?.auditJson).not.toContain('private-session')
    expect(searchSession(local)).toBe('private-session')
  })
})

it('retains effective cooldowns and streak/session checkpoints through pruning and eviction, then prunes superseded rows', async () => {
  const id = await newAgentId()
  const stub = env.AGENTS.getByName(id)
  const now = Date.now()
  await runInDurableObject(stub, async (_agent, state) => {
    const local = await openLocalDb(state.storage)
    const seq = start(local, id, 'old-history', now)
    startSearchAttempt(local, seq, 'exa', now)
    finishSearchAttempt(
      local,
      seq,
      {
        provider: 'exa',
        startedAt: now,
        finishedAt: now,
        status: 429,
        reason: 'rate_limited',
        cooldown: now + 90 * day,
        bytes: 3,
      },
      { blockedUntil: now + 90 * day, consecutive429: 1 },
    )
    startSearchAttempt(local, seq, 'parallel', now)
    finishSearchAttempt(
      local,
      seq,
      {
        provider: 'parallel',
        startedAt: now,
        finishedAt: now,
        status: 200,
        reason: 'succeeded',
        cooldown: null,
        bytes: 7,
      },
      { blockedUntil: 0, consecutive429: 0 },
    )
    saveSearchSession(local, seq, 'old-session')
    finishToolUsage(local, seq, 'succeeded')
    acknowledgeUsage(local, seq, now)
    acknowledgeUsage(local, seq, now + 31 * day)
    expect(local.select().from(usage).all()).toHaveLength(1)
  })
  await evictDurableObject(stub)
  await runInDurableObject(stub, async (_agent, state) => {
    const local = await openLocalDb(state.storage)
    expect(searchProviderState(local, 'exa')).toEqual({
      blockedUntil: now + 90 * day,
      consecutive429: 1,
    })
    expect(searchSession(local)).toBe('old-session')
    const later = now + 91 * day
    const seq = start(local, id, 'new-history', later)
    startSearchAttempt(local, seq, 'exa', later)
    finishSearchAttempt(
      local,
      seq,
      {
        provider: 'exa',
        startedAt: later,
        finishedAt: later,
        status: 429,
        reason: 'rate_limited',
        cooldown: now + 180 * day,
        bytes: 2,
      },
      { blockedUntil: now + 180 * day, consecutive429: 2 },
    )
    startSearchAttempt(local, seq, 'parallel', later)
    finishSearchAttempt(
      local,
      seq,
      {
        provider: 'parallel',
        startedAt: later,
        finishedAt: later,
        status: 200,
        reason: 'succeeded',
        cooldown: null,
        bytes: 5,
      },
      { blockedUntil: 0, consecutive429: 0 },
    )
    saveSearchSession(local, seq, 'new-session')
    finishToolUsage(local, seq, 'succeeded')
    acknowledgeUsage(local, seq, later)
    acknowledgeUsage(local, seq, now + 122 * day)
    expect(local.select().from(usage).all()).toMatchObject([{ task: 'new-history' }])
  })
  await evictDurableObject(stub)
  await runInDurableObject(stub, async (_agent, state) => {
    const local = await openLocalDb(state.storage)
    expect(searchProviderState(local, 'exa')).toEqual({
      blockedUntil: now + 180 * day,
      consecutive429: 2,
    })
    expect(searchProviderState(local, 'parallel')).toEqual({ blockedUntil: 0, consecutive429: 0 })
    expect(searchSession(local)).toBe('new-session')
  })
})
