/**
 * The memory agent's job queue, in its own SQLite.
 *
 * @remarks
 * At most one job is `running`. The object's SQLite runs each call synchronously, so a row read
 * here is still current when the next call writes it.
 *
 * @see docs/memory.md — Jobs
 *
 * @module
 */
import { and, asc, eq, inArray, lte } from 'drizzle-orm'
import { memoryJobs } from '../../drizzle/durable-object/schema.ts'
import type { LocalDb } from './local.ts'
import { JOB_PRIORITY, jobId, parseMemoryJob } from '../memory/jobs.ts'
import type { JobOutcome, JobStatus, MemoryJob } from '../memory/jobs.ts'
import type { RunningJob } from '../memory/job-context.ts'

/** One queued, running, or settled job. */
export type JobRow = typeof memoryJobs.$inferSelect

function toStatus(row: JobRow): JobStatus {
  const job = parseMemoryJob(JSON.parse(row.payloadJson))
  return {
    jobId: row.jobId,
    kind: job.kind,
    status: row.status,
    ...(row.outcome === null ? {} : { outcome: row.outcome }),
    attempts: row.attempts,
  }
}

/** Settled jobs removed per call, to keep each step small. */
const FORGET_BATCH = 500

function jobRow(local: LocalDb, id: string): JobRow | undefined {
  return local.select().from(memoryJobs).where(eq(memoryJobs.jobId, id)).get()
}

/**
 * Queue a job once, or reopen a settled extraction whose checkpoint has not advanced.
 *
 * @remarks
 * Attempts stay monotonic: resetting them would reuse an already completed Pi submission.
 * Redelivery permits another attempt, but does not reset the automatic retry budget.
 */
export async function storeJob(
  local: LocalDb,
  job: MemoryJob,
  checkpoint: number | undefined,
): Promise<JobStatus> {
  const id = await jobId(job)
  local
    .insert(memoryJobs)
    .values({
      jobId: id,
      kind: job.kind,
      priority: JOB_PRIORITY[job.kind],
      payloadJson: JSON.stringify(job),
      notBefore: Date.now(),
      createdAt: Date.now(),
    })
    .onConflictDoNothing({ target: memoryJobs.jobId })
    .run()
  if (job.kind === 'extract' && checkpoint !== undefined && checkpoint <= job.afterEntry) {
    local
      .update(memoryJobs)
      .set({
        status: 'queued',
        outcome: null,
        settledAt: null,
        notBefore: Date.now(),
      })
      .where(and(eq(memoryJobs.jobId, id), eq(memoryJobs.status, 'settled')))
      .run()
  }
  const row = jobRow(local, id)
  if (row === undefined) throw new Error('Job was not stored')
  return toStatus(row)
}

/** A job's status, if the job is known. */
export function jobStatus(local: LocalDb, id: string): JobStatus | undefined {
  const row = jobRow(local, id)
  return row === undefined ? undefined : toStatus(row)
}

/** The running job, for the memory tools. */
export function runningJob(local: LocalDb): RunningJob | undefined {
  const row = local.select().from(memoryJobs).where(eq(memoryJobs.status, 'running')).get()
  return row === undefined
    ? undefined
    : { jobId: row.jobId, job: parseMemoryJob(JSON.parse(row.payloadJson)) }
}

/** The running job to resume, else the queued job due first by priority, then age. */
export function nextJob(local: LocalDb, now: number): JobRow | undefined {
  const running = local.select().from(memoryJobs).where(eq(memoryJobs.status, 'running')).get()
  if (running !== undefined) return running
  return local
    .select()
    .from(memoryJobs)
    .where(and(eq(memoryJobs.status, 'queued'), lte(memoryJobs.notBefore, now)))
    .orderBy(asc(memoryJobs.priority), asc(memoryJobs.createdAt))
    .limit(1)
    .get()
}

/**
 * Mark a queued job running as its next attempt; a running job is resumed as it is.
 *
 * @returns The current row and its parsed job, or undefined if the job is gone.
 */
export function startJob(local: LocalDb, row: JobRow): { row: JobRow; job: MemoryJob } | undefined {
  if (row.status === 'queued') {
    local
      .update(memoryJobs)
      .set({ status: 'running', attempts: row.attempts + 1 })
      .where(eq(memoryJobs.jobId, row.jobId))
      .run()
  }
  const current = jobRow(local, row.jobId)
  return current === undefined
    ? undefined
    : { row: current, job: parseMemoryJob(JSON.parse(current.payloadJson)) }
}

/** Queue the job again for its next attempt at `at`. */
export function retryJob(local: LocalDb, id: string, at: number): void {
  local
    .update(memoryJobs)
    .set({ status: 'queued', notBefore: at })
    .where(eq(memoryJobs.jobId, id))
    .run()
}

/** Mark a job settled with its outcome. */
export function settleJob(local: LocalDb, id: string, outcome: JobOutcome): void {
  local
    .update(memoryJobs)
    .set({ status: 'settled', outcome, settledAt: Date.now() })
    .where(eq(memoryJobs.jobId, id))
    .run()
}

/** When the earliest delayed job is due, or undefined when none is queued. */
export function nextDueAt(local: LocalDb): number | undefined {
  return local
    .select({ notBefore: memoryJobs.notBefore })
    .from(memoryJobs)
    .where(eq(memoryJobs.status, 'queued'))
    .orderBy(asc(memoryJobs.notBefore))
    .limit(1)
    .get()?.notBefore
}

/**
 * Remove settled jobs older than `before`, a batch at a time.
 *
 * @returns How many were removed; call again while it is nonzero.
 */
export function forgetSettledJobs(local: LocalDb, before: number): number {
  const old = local
    .select({ jobId: memoryJobs.jobId })
    .from(memoryJobs)
    .where(and(eq(memoryJobs.status, 'settled'), lte(memoryJobs.settledAt, before)))
    .limit(FORGET_BATCH)
    .all()
  if (old.length === 0) return 0
  local
    .delete(memoryJobs)
    .where(
      inArray(
        memoryJobs.jobId,
        old.map((row) => row.jobId),
      ),
    )
    .run()
  return old.length
}
