/**
 * D1 operation results and terminal failure audit rows for memory jobs.
 *
 * @module
 */
import { eq } from 'drizzle-orm'
import { memoryLedger, memoryOps } from '../../../drizzle/memory/schema.ts'
import type { MemoryDb } from './db.ts'

/** Persisted operation results used to decide a completed job's outcome. */
export async function jobResults(db: MemoryDb, jobId: string): Promise<string[]> {
  const ops = await db
    .select({ resultJson: memoryOps.resultJson })
    .from(memoryOps)
    .where(eq(memoryOps.jobId, jobId))
  return ops.map((op) => op.resultJson)
}

/** Audit a job that exhausted its retries. */
export async function recordJobFailure(
  db: MemoryDb,
  job: { jobId: string; kind: string; attempts: number },
  now: number,
): Promise<void> {
  await db.insert(memoryLedger).values({
    at: now,
    runId: job.jobId,
    actor: 'memory-agent',
    action: 'job_failed',
    target: 'record',
    targetId: job.jobId,
    detailJson: JSON.stringify({ kind: job.kind, attempts: job.attempts }),
  })
}
