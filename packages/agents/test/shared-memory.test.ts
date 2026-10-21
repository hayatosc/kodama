import { evictDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { invalidateOverridesOfRequired } from '../src/memory/memory-agent/consolidation.ts'
import type { Scope } from '../src/memory/store/schema/records.ts'
import { db, record, renderedAlwaysLoaded, write } from './helpers/memory.ts'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'

afterEach(() => vi.restoreAllMocks())

describe('shared spaces', () => {
  it('stores the spaces an agent reads next to its configuration', async () => {
    const agentId = crypto.randomUUID()
    using original = await exports.default.getConfig(agentId)
    expect(original.sharedSpaces).toEqual(['global'])

    await exports.default.setConfig(agentId, { ...original, sharedSpaces: ['team-a', 'global'] })
    await evictDurableObject(env.AGENTS.getByName(agentId))

    using stored = await exports.default.getConfig(agentId)
    expect(stored.sharedSpaces).toEqual(['team-a', 'global'])
    const invalid = await Promise.resolve(
      exports.default.setConfig(agentId, { ...original, sharedSpaces: ['Team A'] }),
    ).then(
      () => 'accepted',
      (error: unknown) => String(error),
    )
    expect(invalid).toMatch(/sharedSpaces/)
  })
})

describe('overrides', () => {
  it('lets an agent record replace a shared record for that agent, unless the shared one is required', async () => {
    const space = `space-${crypto.randomUUID().slice(0, 8)}`
    const scope: Scope = `shared:${space}`
    const agentId = crypto.randomUUID()
    const other = crypto.randomUUID()
    const shared = await write({
      scope,
      kind: 'instruction',
      content: 'Reply in English',
      sourceAgentId: 'memory',
    })
    const rule = await write({
      scope,
      kind: 'instruction',
      content: 'Never push to main',
      sourceAgentId: 'memory',
      required: true,
    })
    await write({
      scope: `agent:${agentId}`,
      kind: 'instruction',
      content: 'Reply in Japanese',
      sourceAgentId: agentId,
      overrides: shared,
    })
    const breaking = await write({
      scope: `agent:${agentId}`,
      kind: 'instruction',
      content: 'Pushing to main is fine',
      sourceAgentId: agentId,
      overrides: rule,
    })

    const mine = await renderedAlwaysLoaded(agentId, [space])
    const theirs = await renderedAlwaysLoaded(other, [space])

    expect(mine).toContain('Reply in Japanese')
    expect(mine).not.toContain('Reply in English')
    expect(mine).toContain('Never push to main')
    expect(mine).not.toContain('Pushing to main is fine')
    expect(theirs).toContain('Reply in English')

    await invalidateOverridesOfRequired(db, 'test-run', Date.now())
    expect((await record(breaking))?.status).toBe('invalid')
  })
})
