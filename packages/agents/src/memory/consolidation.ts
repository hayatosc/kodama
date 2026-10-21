/**
 * The code part of the daily consolidation: retention, re-segmenting, and size records
 * (docs/design/long-term-memory.md, Consolidate). The model part runs as `consolidate` jobs.
 */
import { and, count, desc, eq, gte, inArray, lt } from 'drizzle-orm'
import type { MemoryDb, MemoryRecord, Scope } from './records.ts'
import { memoryLedger, memoryRecords } from './schema.ts'
import { SEARCH_VERSION, storedSearchText } from './search-text.ts'

const DAY_MS = 24 * 60 * 60 * 1000
export const LEDGER_RETENTION_MS = 90 * DAY_MS
export const SETTLED_JOB_RETENTION_MS = 30 * DAY_MS
/** Records one `consolidate` job reads. */
export const CONSOLIDATION_RECORD_LIMIT = 200
/** Scopes consolidated per day; the rest wait for their next change. */
const SCOPES_PER_DAY = 200
/** Rows one maintenance step touches, to stay within one invocation's limits. */
const BATCH_ROWS = 500

/** The UTC day of `now`, the key of one consolidation per scope. */
export function consolidationDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

/** Scopes with a record written or changed since `since`. */
export async function changedScopes(db: MemoryDb, since: number): Promise<Scope[]> {
  const rows = await db
    .selectDistinct({ scope: memoryRecords.scope })
    .from(memoryRecords)
    .where(gte(memoryRecords.updatedAt, since))
    .limit(SCOPES_PER_DAY)
  return rows.map((row) => row.scope)
}

/** Active records of a scope for a `consolidate` job, most used first within each kind. */
export function consolidationRecords(db: MemoryDb, scope: Scope): Promise<MemoryRecord[]> {
  return db
    .select()
    .from(memoryRecords)
    .where(and(eq(memoryRecords.scope, scope), eq(memoryRecords.status, 'active')))
    .orderBy(memoryRecords.kind, desc(memoryRecords.useCount), desc(memoryRecords.updatedAt))
    .limit(CONSOLIDATION_RECORD_LIMIT)
}

/** Rebuild the search text of rows made by an older search-text function. */
export async function resegmentRecords(db: MemoryDb): Promise<number> {
  const rows = await db
    .select({ id: memoryRecords.id, content: memoryRecords.content })
    .from(memoryRecords)
    .where(lt(memoryRecords.searchVersion, SEARCH_VERSION))
    .limit(BATCH_ROWS)
  const [first, ...rest] = rows.map((row) =>
    db
      .update(memoryRecords)
      .set({ searchText: storedSearchText(row.content), searchVersion: SEARCH_VERSION })
      .where(eq(memoryRecords.id, row.id)),
  )
  if (first !== undefined) await db.batch([first, ...rest])
  return rows.length
}

/** Delete ledger rows older than the rollback window, one batch at a time. */
export async function forgetOldLedger(db: MemoryDb, before: number): Promise<number> {
  const rows = await db
    .select({ seq: memoryLedger.seq })
    .from(memoryLedger)
    .where(lt(memoryLedger.at, before))
    .limit(BATCH_ROWS)
  if (rows.length === 0) return 0
  await db.delete(memoryLedger).where(
    inArray(
      memoryLedger.seq,
      rows.map((row) => row.seq),
    ),
  )
  return rows.length
}

/** Log the database size and the active records per scope, to watch growth against D1's limit. */
export async function recordSizes(
  db: MemoryDb,
  d1: D1Database,
  runId: string,
  now: number,
): Promise<void> {
  const probe = await d1.prepare('SELECT 1').run()
  const counts = await db
    .select({ scope: memoryRecords.scope, records: count() })
    .from(memoryRecords)
    .where(eq(memoryRecords.status, 'active'))
    .groupBy(memoryRecords.scope)
  await db.insert(memoryLedger).values({
    at: now,
    runId,
    actor: 'consolidation',
    action: 'meta',
    target: 'record',
    targetId: '',
    detailJson: JSON.stringify({ sizeAfter: probe.meta.size_after, counts }),
  })
}
