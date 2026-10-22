/**
 * Search ranking and usage across D1's per-statement parameter boundary.
 *
 * @module
 */
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { memoryRecords, memoryTerms } from '../../../drizzle/d1/schema.ts'
import { db, parameterLimitedDb } from '../../helper/memory.ts'
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
