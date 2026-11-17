/**
 * Data-access repository for memory term search and usage counter updates in memory D1.
 *
 * @module
 */
import { prepareQuery, runBatch } from '../../lib/reylo.ts'
import { agentScope, parseMemoryRecord } from './db.ts'
import type { MemoryDb, MemoryRecord, Scope } from './db.ts'
import { queries } from './queries/index.ts'

/** Active record IDs matching a single search term either exactly or by prefix range. */
export async function listMatchingRecordIds(
  db: MemoryDb,
  term: string,
  prefix: boolean,
  scopes: readonly Scope[],
  forAgent: string | undefined,
  limit: number,
): Promise<string[]> {
  const own = forAgent === undefined ? null : agentScope(forAgent)
  const scopesJson = JSON.stringify(scopes)
  const rows = prefix
    ? await queries.listRecordsWithTermPrefix.run(db, {
        own,
        scopesJson,
        termFrom: term,
        // A prefix is the range of terms from it up to the next possible string.
        termTo: `${term}\u{10FFFF}`,
        limit,
      })
    : await queries.listRecordsWithTermExact.run(db, {
        own,
        scopesJson,
        term,
        limit,
      })
  return rows.map((row) => row.id)
}

/** Hydrate memory records for a chunk of matched IDs. */
export async function listMemoryRecordsByIds(
  db: MemoryDb,
  ids: readonly string[],
): Promise<MemoryRecord[]> {
  if (ids.length === 0) return []
  const rows = await queries.listMemoryRecordsByIds.run(db, { idsJson: JSON.stringify(ids) })
  return rows.map(parseMemoryRecord)
}

/** Increment `useCount` and update `lastUsedAt` for returned search results in one batch. */
export async function incrementMemoryRecordUses(
  db: MemoryDb,
  records: readonly MemoryRecord[],
  now: number,
): Promise<void> {
  if (records.length === 0) return
  await runBatch(
    db,
    records.map((record) =>
      prepareQuery(db, queries.updateIncrementMemoryRecordUse, {
        id: record.id,
        nextUseCount: record.useCount + 1,
        lastUsedAt: now,
      }),
    ),
  )
}
