/**
 * The code part of the daily consolidation: retention, re-segmenting, and size records
 * (docs/memory.md, Consolidate). The model part runs as `consolidate` jobs.
 */
import { and, count, desc, eq, gte, inArray, lt } from 'drizzle-orm'
import { curateSkills, forgetSkillBlobs } from '../skills/curation.ts'
import { finishPendingSkillWrites } from '../skills/write.ts'
import { applyOperation } from '../store/records.ts'
import { termStatements } from '../store/statements.ts'
import type { MemoryDb, MemoryRecord } from '../store/db.ts'
import type { Scope } from '../../../drizzle/d1/schema/records.ts'
import {
  memoryLedger,
  memoryRecords,
  memoryTerms,
  revisionClaims,
} from '../../../drizzle/d1/schema/records.ts'
import { SEARCH_VERSION } from '../store/search-text.ts'
import type { MemoryJob } from './jobs.ts'

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

/** Rows rebuilt per batch: each takes a few statements, and a batch should stay small. */
const RESEGMENT_ROWS = 50

/** Rebuild the search terms of records indexed by an older search-text function. */
export async function resegmentRecords(db: MemoryDb): Promise<number> {
  const rows = await db
    .select({ id: memoryRecords.id, content: memoryRecords.content })
    .from(memoryRecords)
    .where(lt(memoryRecords.searchVersion, SEARCH_VERSION))
    .limit(RESEGMENT_ROWS)
  const [first, ...rest] = rows.flatMap((row) => [
    db.delete(memoryTerms).where(eq(memoryTerms.recordId, row.id)),
    ...termStatements(db, row.id, row.content),
    db
      .update(memoryRecords)
      .set({ searchVersion: SEARCH_VERSION })
      .where(eq(memoryRecords.id, row.id)),
  ])
  if (first !== undefined) await db.batch([first, ...rest])
  return rows.length
}

/**
 * Delete revision claims older than the rollback window: a writer that read a revision that long
 * ago has long since finished.
 */
export async function forgetOldClaims(db: MemoryDb, before: number): Promise<void> {
  await db.delete(revisionClaims).where(lt(revisionClaims.claimedAt, before))
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
export async function recordSizes(db: MemoryDb, runId: string, now: number): Promise<void> {
  // Every D1 result reports the database size after the statement.
  const probe = await db.select({ id: memoryLedger.seq }).from(memoryLedger).limit(1).run()
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

/**
 * An agent record cannot override a required shared record: such a record is never loaded, so
 * mark it invalid, with the ledger row the operation writes.
 */
export async function invalidateOverridesOfRequired(
  db: MemoryDb,
  runId: string,
  now: number,
): Promise<number> {
  const required = db
    .select({ id: memoryRecords.id })
    .from(memoryRecords)
    .where(and(eq(memoryRecords.required, true), eq(memoryRecords.status, 'active')))
  const rows = await db
    .select({ id: memoryRecords.id, revision: memoryRecords.revision })
    .from(memoryRecords)
    .where(and(eq(memoryRecords.status, 'active'), inArray(memoryRecords.overrides, required)))
    .limit(BATCH_ROWS)
  for (const row of rows) {
    await applyOperation(
      db,
      {
        opId: `required:${row.id}@${row.revision}`,
        jobId: runId,
        runId,
        actor: 'consolidation',
        now,
      },
      {
        type: 'invalidate',
        id: row.id,
        revision: row.revision,
        reason: 'overrides a required shared record',
      },
    )
  }
  return rows.length
}

export interface DailyConsolidationDeps {
  db: MemoryDb
  bucket: R2Bucket
  /** Remove settled jobs older than the time given. */
  forgetSettledJobs: (before: number) => Promise<number>
  enqueue: (job: MemoryJob) => Promise<unknown>
  now: number
}

/**
 * The daily consolidation: retention, re-segmenting, overrides of required records, and skill
 * curation in code, then one `consolidate` job per scope changed in the last day.
 */
export async function consolidateDaily(deps: DailyConsolidationDeps): Promise<{ scopes: number }> {
  const { db, bucket, now } = deps
  const runId = `consolidate:${consolidationDay(now)}`
  await deps.forgetSettledJobs(now - SETTLED_JOB_RETENTION_MS)
  await forgetOldLedger(db, now - LEDGER_RETENTION_MS)
  await forgetOldClaims(db, now - LEDGER_RETENTION_MS)
  await resegmentRecords(db)
  await invalidateOverridesOfRequired(db, runId, now)
  await finishPendingSkillWrites(db, bucket, now)
  await curateSkills(db, runId, now)
  await forgetSkillBlobs(db, bucket, now)
  const scopes = await changedScopes(db, now - DAY_MS)
  for (const scope of scopes) {
    await deps.enqueue({ kind: 'consolidate', scope, day: consolidationDay(now) })
  }
  await recordSizes(db, runId, now)
  return { scopes: scopes.length }
}
