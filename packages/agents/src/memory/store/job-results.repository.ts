/**
 * Data-access repository for memory job operation results and terminal failure audit rows.
 *
 * @module
 */
import type { MemoryDb } from './db.ts'
import { queries } from './queries/index.ts'

/** Persisted operation results used to decide a completed job's outcome. */
export async function jobResults(db: MemoryDb, jobId: string): Promise<string[]> {
  const ops = await queries.listJobOpsResults.run(db, { jobId })
  return ops.map((op) => op.resultJson)
}

/** Audit a job that exhausted its retries. */
export async function recordJobFailure(
  db: MemoryDb,
  job: { jobId: string; kind: string; attempts: number },
  now: number,
): Promise<void> {
  await queries.insertMemoryLedger.run(db, {
    at: now,
    runId: job.jobId,
    opId: null,
    actor: 'memory-agent',
    action: 'job_failed',
    target: 'record',
    targetId: job.jobId,
    detailJson: JSON.stringify({ kind: job.kind, attempts: job.attempts }),
  })
}
