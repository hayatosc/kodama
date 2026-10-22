/**
 * Searching memory records by their words.
 *
 * @see docs/memory.md — Search text, Queries
 *
 * @module
 */
import { and, eq, gte, inArray, lt } from 'drizzle-orm'
import type { MemoryDb, MemoryRecord } from './db.ts'
import { memoryRecords, memoryTerms } from '../../../drizzle/d1/schema.ts'
import type { Scope } from '../../../drizzle/d1/schema.ts'
import { searchTermSets } from '../../lib/search-text.ts'

/** What to search, and where. */
export interface SearchOptions {
  query: string
  scopes: readonly Scope[]
  now: number
  /** Defaults to 10. */
  limit?: number
  /** Count the returned records as used; the memory agent's own lookups do not. Default true. */
  countUse?: boolean
}

const EVENT_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000

/** Higher is better: importance, use, and for events, recency. */
function score(record: MemoryRecord, now: number): number {
  const age = Math.max(0, now - record.observedAt)
  const recency = record.kind === 'event' ? 0.5 ** (age / EVENT_HALF_LIFE_MS) : 1
  return (0.5 + record.importance) * recency * (1 + Math.log1p(record.useCount) / 10)
}

/** Candidates per query word, enough for a scope of a few thousand records. */
const CANDIDATES_PER_WORD = 500

/** Active records of the scopes that have `term`, or a term starting with it. */
async function recordsWithTerm(
  db: MemoryDb,
  term: string,
  prefix: boolean,
  scopes: readonly Scope[],
): Promise<Set<string>> {
  const rows = await db
    .select({ id: memoryTerms.recordId })
    .from(memoryTerms)
    .innerJoin(memoryRecords, eq(memoryRecords.id, memoryTerms.recordId))
    .where(
      and(
        // A prefix is the range of terms from it up to the next possible string.
        prefix
          ? and(gte(memoryTerms.term, term), lt(memoryTerms.term, `${term}\u{10FFFF}`))
          : eq(memoryTerms.term, term),
        eq(memoryRecords.status, 'active'),
        inArray(memoryRecords.scope, [...scopes]),
      ),
    )
    .limit(CANDIDATES_PER_WORD)
  return new Set(rows.map((row) => row.id))
}

/**
 * Search the active records of the given scopes for every word of the query.
 *
 * @remarks
 * Tries the merged words, then the original segments, then each merged word as a prefix. Ranks by
 * importance and use, and events also by recency. Returned records count as used.
 */
export async function searchMemory(
  db: MemoryDb,
  { query, scopes, now, limit = 10, countUse = true }: SearchOptions,
): Promise<MemoryRecord[]> {
  if (scopes.length === 0) return []
  for (const { terms, prefix } of searchTermSets(query)) {
    let matches: Set<string> | undefined
    for (const term of terms) {
      const found = await recordsWithTerm(db, term, prefix, scopes)
      matches = matches === undefined ? found : new Set([...matches].filter((id) => found.has(id)))
      if (matches.size === 0) break
    }
    if (matches === undefined || matches.size === 0) continue
    const records = await db
      .select()
      .from(memoryRecords)
      .where(inArray(memoryRecords.id, [...matches].slice(0, CANDIDATES_PER_WORD)))
    const ranked = records
      .map((record) => ({ record, score: score(record, now) }))
      .sort((a, b) => b.score - a.score || b.record.updatedAt - a.record.updatedAt)
      .slice(0, limit)
      .map(({ record }) => record)
    if (countUse) await countUses(db, ranked, now)
    return ranked
  }
  return []
}

/** One more use of each record; a use counted twice at the same moment may be lost, which is fine. */
async function countUses(db: MemoryDb, records: readonly MemoryRecord[], now: number) {
  const [first, ...rest] = records.map((record) =>
    db
      .update(memoryRecords)
      .set({ useCount: record.useCount + 1, lastUsedAt: now })
      .where(eq(memoryRecords.id, record.id)),
  )
  if (first !== undefined) await db.batch([first, ...rest])
}
