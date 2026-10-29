/** Atomic contact, adopted-input permissions and persistent admission caps. @module */
import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import { newAgentId } from '../helper/management.ts'
import { openLocalDb } from './local.ts'
import {
  adoptPermissions,
  admitWeb,
  contactBoundary,
  grantSources,
  markContact,
  requireTrusted,
} from './external-data.ts'
import { finishToolUsage, interruptUsage, startToolUsage, usageSince } from './usage.ts'
import { finishSearchAttempt, searchProviderState, startSearchAttempt } from './web-search.ts'

it('consumes exact adopted permissions once, retains the first boundary and rejects another run', async () => {
  const id = await newAgentId()
  await runInDurableObject(env.AGENTS.getByName(id), async (_, state) => {
    const local = await openLocalDb(state.storage)
    let task = 0
    const call = (
      argument: string,
      run = 'run',
      inputs = [1],
      tool: 'web_search' | 'web_fetch' = 'web_search',
    ) => {
      const seq = startToolUsage(
        local,
        { chargedAgentId: id, actorKind: 'user' },
        String(++task),
        tool,
      )
      try {
        return admitWeb(local, {
          seq,
          root: 'root',
          run,
          inputs,
          argument,
          tool,
          keyless: false,
          eligibleThrough: 50,
        })
      } finally {
        finishToolUsage(local, seq, 'succeeded')
      }
    }
    expect(call('first')).toBeNull()
    expect(contactBoundary(local, 'root')).toBe(50)
    markContact(local, 'root', 'peer', 99)
    expect(contactBoundary(local, 'root')).toBe(50)
    expect(() => requireTrusted(local, 'root')).toThrow('untrusted_context')
    adoptPermissions(local, 'root', 'run', 1, { queries: ['exact', 'unused'] })
    expect(() => call('exact ', 'run')).toThrow('untrusted_context')
    expect(() => call('exact', 'run', [2])).toThrow('untrusted_context')
    expect(() => call('unused', 'next')).toThrow('untrusted_context')
    expect(call('exact')).toBeTypeOf('string')
    adoptPermissions(local, 'root', 'next', 1, { queries: ['exact', 'unused'] })
    expect(() => call('exact')).toThrow('untrusted_context')
    expect(() => call('unused', 'next')).toThrow('untrusted_context')
    grantSources(local, 'root', 'run', ['https://example.org/'])
    expect(call('https://example.org/', 'run', [], 'web_fetch')).toBeTypeOf('string')
    expect(() => call('https://example.org/', 'run', [], 'web_fetch')).toThrow('untrusted_context')
    expect(() => call('https://example.org/link', 'run', [], 'web_fetch')).toThrow(
      'untrusted_context',
    )
  })
})

it('serializes concurrency and rate limits and retains interrupted sends and audit', async () => {
  const id = await newAgentId()
  await runInDurableObject(env.AGENTS.getByName(id), async (_, state) => {
    const local = await openLocalDb(state.storage)
    const now = Date.now()
    const start = (task: string, keyless: boolean) => {
      const seq = startToolUsage(
        local,
        { chargedAgentId: id, actorKind: 'user' },
        task,
        'web_search',
      )
      adoptPermissions(local, 'root', 'run', 1, { queries: [task] })
      admitWeb(
        local,
        {
          seq,
          root: 'root',
          run: 'run',
          inputs: [1],
          tool: 'web_search',
          argument: task,
          keyless,
          eligibleThrough: 5,
        },
        now,
      )
      return seq
    }
    const first = start('first', true)
    expect(() => start('other-keyless', true)).toThrow('busy')
    const second = start('native', false)
    expect(() => start('excess', false)).toThrow('busy')
    finishToolUsage(local, second, 'failed')
    for (let index = 0; index < 10; index++) startSearchAttempt(local, first, 'exa', now)
    expect(() => startSearchAttempt(local, first, 'firecrawl', now)).toThrow('rate_limited')
    finishSearchAttempt(
      local,
      first,
      {
        provider: 'exa',
        startedAt: now,
        finishedAt: now,
        status: 429,
        reason: 'rate_limited',
        cooldown: now + 86400000,
        bytes: 3,
      },
      { blockedUntil: now + 86400000, consecutive429: 1 },
    )
    interruptUsage(local)
    expect(usageSince(local, 0, 20).rows.find((row) => row.seq === first)).toMatchObject({
      status: 'interrupted',
      httpCount: 0,
      totalCost: null,
      auditJson: expect.stringContaining('interrupted'),
    })
    const reopened = await openLocalDb(state.storage)
    expect(searchProviderState(reopened, 'exa')).toMatchObject({
      blockedUntil: now + 86400000,
      consecutive429: 1,
    })
    expect(contactBoundary(reopened, 'root')).toBe(5)
    for (let index = 0; index < 8; index++)
      finishToolUsage(local, start(`later${index}`, false), 'failed')
    expect(() => start('limited', false)).toThrow('rate_limited')
  })
})
