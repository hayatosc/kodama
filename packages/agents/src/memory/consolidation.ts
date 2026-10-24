/**
 * Daily consolidation workflow: bounded retention and maintenance, then model jobs for changed scopes.
 *
 * @see docs/memory.md — Consolidate
 *
 * @module
 */
import type { MemoryJob } from './jobs.ts'
import type { MemoryDb } from './store/db.ts'
import { curateSkills } from './store/skills.ts'
import {
  changedScopes,
  forgetOldClaims,
  forgetOldLedger,
  invalidateOverridesOfRequired,
  recordSizes,
  resegmentRecords,
} from './store/maintenance.ts'

const DAY_MS = 24 * 60 * 60 * 1000
/** How long ledger rows and revision claims are kept. */
export const LEDGER_RETENTION_MS = 90 * DAY_MS
/** How long settled jobs are kept in the memory agent's queue. */
export const SETTLED_JOB_RETENTION_MS = 30 * DAY_MS
/** Bound daily retention work per table; any remaining expired rows wait for the next run. */
const RETENTION_BATCHES_PER_DAY = 20

/** The UTC day of `now`, the key of one consolidation per scope. */
export function consolidationDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

/** What the daily consolidation needs from the memory agent. */
export interface DailyConsolidationDeps {
  db: MemoryDb
  /** Remove settled jobs older than the time given. */
  forgetSettledJobs: (before: number) => Promise<number>
  enqueue: (job: MemoryJob) => Promise<unknown>
  now: number
}

/**
 * Run maintenance, then queue one consolidation per scope changed in the last day.
 *
 * @returns How many scopes got a job, at most 200.
 */
export async function consolidateDaily(deps: DailyConsolidationDeps): Promise<{ scopes: number }> {
  const { db, now } = deps
  const runId = `consolidate:${consolidationDay(now)}`
  for (let batch = 0; batch < RETENTION_BATCHES_PER_DAY; batch += 1) {
    if ((await deps.forgetSettledJobs(now - SETTLED_JOB_RETENTION_MS)) === 0) break
  }
  for (let batch = 0; batch < RETENTION_BATCHES_PER_DAY; batch += 1) {
    if ((await forgetOldLedger(db, now - LEDGER_RETENTION_MS)) === 0) break
  }
  await forgetOldClaims(db, now - LEDGER_RETENTION_MS)
  await resegmentRecords(db)
  await invalidateOverridesOfRequired(db, runId, now)
  await curateSkills(db, runId, now)
  const scopes = await changedScopes(db, now - DAY_MS)
  for (const scope of scopes) {
    await deps.enqueue({ kind: 'consolidate', scope, day: consolidationDay(now) })
  }
  await recordSizes(db, runId, now)
  return { scopes: scopes.length }
}
