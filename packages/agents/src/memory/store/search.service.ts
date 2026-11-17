/**
 * Searching memory records by their words.
 *
 * @see docs/memory.md — Search text, Queries
 *
 * @module
 */
import { searchTermSets } from '../../lib/search-text.ts'
import type { MemoryDb, MemoryRecord, Scope } from './db.ts'
import {
  incrementMemoryRecordUses,
  listMatchingRecordIds,
  listMemoryRecordsByIds,
} from './search.repository.ts'

/** What to search, and where. */
export interface SearchOptions {
  query: string
  scopes: readonly Scope[]
  now: number
  /** Defaults to 10. */
  limit?: number
  /** Count the returned records as used; the memory agent's own lookups do not. Default true. */
  countUse?: boolean
  /** Apply this working agent's shared-record precedence; omitted for raw maintenance lookups. */
  forAgent?: string
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
/** Fetch batch size, keeping memory overhead bounded per round-trip. */
const RECORDS_PER_FETCH = 100

/**
 * Search the active records of the given scopes for every word of the query.
 *
 * @remarks
 * Tries the merged words, then the original segments, then each merged word as a prefix. Ranks by
 * importance and use, and events also by recency. Returned records count as used.
 */
export async function searchMemory(
  db: MemoryDb,
  { query, scopes, now, limit = 10, countUse = true, forAgent }: SearchOptions,
): Promise<MemoryRecord[]> {
  if (scopes.length === 0) return []
  for (const { terms, prefix } of searchTermSets(query)) {
    let matches: Set<string> | undefined
    for (const term of terms) {
      const found = new Set(
        await listMatchingRecordIds(db, term, prefix, scopes, forAgent, CANDIDATES_PER_WORD),
      )
      matches = matches === undefined ? found : new Set([...matches].filter((id) => found.has(id)))
      if (matches.size === 0) break
    }
    if (matches === undefined || matches.size === 0) continue
    const ids = [...matches].slice(0, CANDIDATES_PER_WORD)
    const records: MemoryRecord[] = []
    for (let offset = 0; offset < ids.length; offset += RECORDS_PER_FETCH) {
      const chunk = ids.slice(offset, offset + RECORDS_PER_FETCH)
      records.push(...(await listMemoryRecordsByIds(db, chunk)))
    }
    const ranked = records
      .map((record) => ({ record, score: score(record, now) }))
      .sort((a, b) => b.score - a.score || b.record.updatedAt - a.record.updatedAt)
      .slice(0, limit)
      .map(({ record }) => record)
    if (countUse) await incrementMemoryRecordUses(db, ranked, now)
    return ranked
  }
  return []
}
