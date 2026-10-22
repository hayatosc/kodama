/**
 * Search ranking and usage across D1's per-statement parameter boundary.
 *
 * @module
 */
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { memoryRecords, memoryTerms } from '../../../drizzle/d1/schema.ts'
import { db, parameterLimitedDb, record, write } from '../../helper/memory.ts'
import { readableScopes } from './db.ts'
import { SEARCH_VERSION } from '../../lib/search-text.ts'
import { searchMemory } from './search.ts'

const NOW = 1_800_000_000_000

async function seedCandidates(agentId: string, size: number): Promise<void> {
  for (let offset = 0; offset < size; offset += 20) {
    const statements = Array.from({ length: Math.min(20, size - offset) }, (_, index) => {
      const candidate = offset + index
      const id = `${agentId}-${candidate}`
      return [
        db.insert(memoryRecords).values({
          id,
          scope: `agent:${agentId}`,
          kind: 'fact',
          content: `needle ${candidate}`,
          searchVersion: SEARCH_VERSION,
          origin: 'agent_judgment',
          sourceAgentId: agentId,
          runId: 'search-boundary',
          importance: candidate / size,
          observedAt: NOW,
          createdAt: NOW,
          updatedAt: NOW,
        }),
        db.insert(memoryTerms).values({ recordId: id, term: 'needle' }),
      ]
    }).flat()
    const [first, ...rest] = statements
    if (first !== undefined) await db.batch([first, ...rest])
  }
}

describe('working-agent search precedence', () => {
  it('excludes prohibited overrides before ranking, limiting, and counting use', async () => {
    const agentId = crypto.randomUUID()
    const space = crypto.randomUUID()
    const target = await write({
      scope: `shared:${space}`,
      kind: 'instruction',
      content: 'Never push to main',
      sourceAgentId: 'memory',
      required: true,
    })
    const prohibited = await write({
      scope: `agent:${agentId}`,
      kind: 'instruction',
      content: 'Pushing to main is fine',
      sourceAgentId: agentId,
      overrides: target,
      importance: 1,
    })
    const allowed = await write({
      scope: `agent:${agentId}`,
      kind: 'fact',
      content: 'Pushing to a feature branch is permitted',
      sourceAgentId: agentId,
      importance: 0,
    })
    const options = {
      query: 'Pushing',
      scopes: readableScopes(agentId, [space]),
      now: NOW,
      limit: 1,
      forAgent: agentId,
    }
    const found = await searchMemory(parameterLimitedDb, options)
    expect(found.map((row) => row.content)).toEqual(['Pushing to a feature branch is permitted'])
    expect((await record(prohibited))?.useCount).toBe(0)
    expect((await record(allowed))?.useCount).toBe(1)
    expect((await record(target))?.useCount).toBe(0)

    const rawOptions = { ...options, forAgent: undefined, countUse: false }
    const raw = await searchMemory(db, rawOptions)
    expect(raw.map((row) => row.content)).toEqual(['Pushing to main is fine'])
    const required = await searchMemory(parameterLimitedDb, { ...options, query: 'main' })
    expect(required.map((row) => row.content)).toEqual(['Never push to main'])
  })

  it('resolves overrides outside query matches without suppressing another agent’s view', async () => {
    const agentId = crypto.randomUUID()
    const other = crypto.randomUUID()
    const space = crypto.randomUUID()
    const target = await write({
      scope: `shared:${space}`,
      kind: 'instruction',
      content: 'Reply in English',
      sourceAgentId: 'memory',
    })
    const override = await write({
      scope: `agent:${agentId}`,
      kind: 'instruction',
      content: 'Reply in Japanese',
      sourceAgentId: agentId,
      overrides: target,
    })
    const options = {
      query: 'English',
      scopes: readableScopes(agentId, [space]),
      now: NOW,
      forAgent: agentId,
    }
    expect(await searchMemory(parameterLimitedDb, options)).toEqual([])
    expect((await record(target))?.useCount).toBe(0)
    const theirOptions = { ...options, scopes: readableScopes(other, [space]), forAgent: other }
    const theirs = await searchMemory(parameterLimitedDb, theirOptions)
    expect(theirs.map((row) => row.content)).toEqual(['Reply in English'])
    const mine = await searchMemory(parameterLimitedDb, { ...options, query: 'Reply' })
    expect(mine.map((row) => row.content)).toEqual(['Reply in Japanese'])
    await db.update(memoryRecords).set({ status: 'invalid' }).where(eq(memoryRecords.id, override))
    const restored = await searchMemory(parameterLimitedDb, options)
    expect(restored.map((row) => row.content)).toEqual(['Reply in English'])
  })

  it('does not let unreadable or inactive required targets suppress personal memory', async () => {
    const agentId = crypto.randomUUID()
    const space = crypto.randomUUID()
    const target = await write({
      scope: `shared:${space}`,
      kind: 'instruction',
      content: 'Never push to main',
      sourceAgentId: 'memory',
      required: true,
    })
    await write({
      scope: `agent:${agentId}`,
      kind: 'instruction',
      content: 'Pushing to main is fine',
      sourceAgentId: agentId,
      overrides: target,
    })
    const options = {
      query: 'Pushing',
      scopes: readableScopes(agentId, []),
      now: NOW,
      forAgent: agentId,
    }
    expect((await searchMemory(parameterLimitedDb, options)).map((row) => row.content)).toEqual([
      'Pushing to main is fine',
    ])
    await db.update(memoryRecords).set({ status: 'invalid' }).where(eq(memoryRecords.id, target))
    const visible = await searchMemory(parameterLimitedDb, {
      ...options,
      scopes: readableScopes(agentId, [space]),
    })
    expect(visible.map((row) => row.content)).toEqual(['Pushing to main is fine'])
  })
})

describe('search parameter limits', () => {
  it.each([
    { size: 100, expected: ['needle 99', 'needle 98', 'needle 97'] },
    { size: 101, expected: ['needle 100', 'needle 99', 'needle 98'] },
    { size: 500, expected: ['needle 499', 'needle 498', 'needle 497'] },
  ])(
    'ranks all $size candidates before limiting and counts only returned records',
    async ({ size, expected }) => {
      const agentId = crypto.randomUUID()
      await seedCandidates(agentId, size)

      const found = await searchMemory(parameterLimitedDb, {
        query: 'needle',
        scopes: [`agent:${agentId}`],
        now: NOW,
        limit: 3,
        forAgent: agentId,
      })

      expect(found.map((record) => record.content)).toEqual(expected)
      const used = await db
        .select({ content: memoryRecords.content, lastUsedAt: memoryRecords.lastUsedAt })
        .from(memoryRecords)
        .where(and(eq(memoryRecords.scope, `agent:${agentId}`), eq(memoryRecords.useCount, 1)))
      expect(used.map((record) => record.content).sort()).toEqual([...expected].sort())
      expect(used.map((record) => record.lastUsedAt)).toEqual([NOW, NOW, NOW])
      const unused = await db
        .select({ id: memoryRecords.id })
        .from(memoryRecords)
        .where(and(eq(memoryRecords.scope, `agent:${agentId}`), eq(memoryRecords.useCount, 0)))
      expect(unused).toHaveLength(size - 3)
    },
  )
})
