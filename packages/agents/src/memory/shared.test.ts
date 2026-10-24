import { evictDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { memoryRecords } from '../../drizzle/d1/schema.ts'
import type { Scope } from '../../drizzle/d1/schema.ts'
import { invalidateOverridesOfRequired } from './consolidation.ts'
import { writeShared } from './shared.ts'
import { context, db, record, renderedAlwaysLoaded, write } from '../helper/memory.ts'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'
import { newAgentId, updateSettings } from '../helper/control.ts'

afterEach(() => vi.restoreAllMocks())

function newSpace(): string {
  return `space-${crypto.randomUUID().slice(0, 8)}`
}

function fact(content: string, agentId: string = crypto.randomUUID()): Promise<string> {
  return write({ scope: `agent:${agentId}`, kind: 'fact', content, sourceAgentId: agentId })
}

function activeIn(space: string) {
  return db
    .select()
    .from(memoryRecords)
    .where(and(eq(memoryRecords.scope, `shared:${space}`), eq(memoryRecords.status, 'active')))
}

describe('shared spaces', () => {
  it('stores the spaces an agent reads next to its configuration', async () => {
    const agentId = await newAgentId()
    using original = await env.AGENTS.getByName(agentId).getConfig()
    expect(original.sharedSpaces).toEqual(['global'])

    await updateSettings(agentId, { sharedSpaces: ['team-a', 'global'] })
    await evictDurableObject(env.AGENTS.getByName(agentId))

    using stored = await env.AGENTS.getByName(agentId).getConfig()
    expect(stored.sharedSpaces).toEqual(['team-a', 'global'])
    const invalid = await Promise.resolve(
      updateSettings(agentId, { sharedSpaces: ['Team A'] }),
    ).then(
      () => 'accepted',
      (error: unknown) => String(error),
    )
    expect(invalid).toMatch(/sharedSpaces/)
  })
})

describe('overrides', () => {
  it('lets an agent record replace a shared record for that agent, unless the shared one is required', async () => {
    const space = newSpace()
    const scope: Scope = `shared:${space}`
    const agentId = await newAgentId()
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

describe('shared writes', () => {
  it('writes a record that two agents keep, once, with no person involved', async () => {
    const space = newSpace()
    const content = 'The staging cluster is in Osaka'
    const ctx = context()
    const input = {
      space,
      kind: 'fact' as const,
      content,
      sourceIds: [await fact(content), await fact(content)],
    }

    const first = await writeShared(db, ctx, input)
    const repeat = await writeShared(db, ctx, input)

    expect(first.status).toBe('applied')
    expect(repeat).toMatchObject({ status: 'applied', replayed: true })
    expect((await activeIn(space)).map((row) => [row.content, row.origin])).toEqual([
      [content, 'shared'],
    ])
    expect(await renderedAlwaysLoaded(crypto.randomUUID(), [space])).toContain(content)
  })

  it('rejects what one agent keeps and a required rule without two agents', async () => {
    const space = newSpace()
    const agentId = await newAgentId()
    const shared = await write({
      scope: `shared:${space}`,
      kind: 'instruction',
      content: 'Prefer small pull requests',
      sourceAgentId: 'memory',
    })

    const results = [
      await writeShared(db, context(), {
        space,
        kind: 'fact',
        content: 'Only I think this',
        sourceIds: [await fact('Only I think this', agentId), await fact('Me again', agentId)],
      }),
      await writeShared(db, context(), {
        space,
        kind: 'instruction',
        content: 'Always prefer small pull requests',
        required: true,
        replaces: shared,
        sourceIds: [shared],
      }),
    ]

    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected'])
    expect((await activeIn(space)).map((row) => row.content)).toEqual([
      'Prefer small pull requests',
    ])
  })

  it('replaces a shared record when the sources are records of that space', async () => {
    const space = newSpace()
    const target = await write({
      scope: `shared:${space}`,
      kind: 'fact',
      content: 'Builds take ten minutes',
      sourceAgentId: 'memory',
    })

    const result = await writeShared(db, context(), {
      space,
      kind: 'fact',
      content: 'Builds take 10 minutes',
      replaces: target,
      sourceIds: [target],
    })

    expect(result.status).toBe('applied')
    expect((await record(target))?.status).toBe('superseded')
    expect((await activeIn(space)).map((row) => row.content)).toEqual(['Builds take 10 minutes'])
  })
})
