/**
 * The memory agent's job queue, in its own SQLite.
 *
 * @remarks
 * At most one job is `running`. The object's SQLite runs each call synchronously, so a row read
 * here is still current when the next call writes it.
 *
 * @see docs/memory.md — Jobs
 * @module
 */
import { parseEnum, parseJsonValue, parseNullableEnum } from '../../lib/reylo.ts'
import type { RunningJob } from '../../memory/extraction/context.ts'
import { JOB_PRIORITY, jobId, parseMemoryJob } from '../../memory/jobs.ts'
import type { JobOutcome, JobStatus, MemoryJob } from '../../memory/jobs.ts'
import type { LocalDb } from './local.ts'
import { queries } from './queries/index.ts'

const JOB_STATUSES = ['queued', 'running', 'settled'] as const
const JOB_OUTCOMES = ['persisted', 'declined', 'conflict', 'failed'] as const

/** One queued, running, or settled job. */
export interface JobRow {
  jobId: string
  kind: string
  priority: number
  payloadJson: string
  status: (typeof JOB_STATUSES)[number]
  outcome: JobOutcome | null
  attempts: number
  notBefore: number
  startedAt: number | null
  createdAt: number
  settledAt: number | null
}

function parseJobRow(row: {
  jobId: string
  kind: string
  priority: number
  payloadJson: string
  status: string
  outcome: string | null
  attempts: number
  notBefore: number
  startedAt: number | null
  createdAt: number
  settledAt: number | null
}): JobRow {
  return {
    ...row,
    status: parseEnum(JOB_STATUSES, row.status, 'memory job status'),
    outcome: parseNullableEnum(JOB_OUTCOMES, row.outcome, 'memory job outcome'),
  }
}

function toStatus(row: JobRow): JobStatus {
  const job = parseMemoryJob(parseJsonValue(row.payloadJson))
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

/** Read one job row by ID, if present. */
export function jobRow(local: LocalDb, id: string): JobRow | undefined {
  const row = queries.getMemoryJobById.runSync(local.sql, { jobId: id })
  return row === null ? undefined : parseJobRow(row)
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
  const now = Date.now()
  queries.insertMemoryJob.runSync(local.sql, {
    jobId: id,
    kind: job.kind,
    priority: JOB_PRIORITY[job.kind],
    payloadJson: JSON.stringify(job),
    notBefore: now,
    createdAt: now,
  })
  if (job.kind === 'extract' && checkpoint !== undefined && checkpoint <= job.afterEntry) {
    queries.updateReopenMemoryJob.runSync(local.sql, {
      jobId: id,
      notBefore: Date.now(),
    })
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
  const row = queries.getRunningMemoryJob.runSync(local.sql)
  return row === null
    ? undefined
    : { jobId: row.jobId, job: parseMemoryJob(parseJsonValue(row.payloadJson)) }
}

/**
 * How long a queued job may wait past its due time before it runs ahead of higher priorities. A
 * steady stream of `remember` and `extract` jobs would otherwise keep `consolidate` waiting forever.
 */
export const STARVATION_LIMIT_MS = 60 * 60_000

/**
 * The running job to resume; else the job overdue by more than {@link STARVATION_LIMIT_MS}, longest
 * overdue first; else the queued job due first by priority, then age.
 */
export function nextJob(local: LocalDb, now: number): JobRow | undefined {
  const running = queries.getRunningMemoryJob.runSync(local.sql)
  if (running !== null) return parseJobRow(running)
  const starved = queries.getStarvedMemoryJob.runSync(local.sql, {
    before: now - STARVATION_LIMIT_MS,
  })
  if (starved !== null) return parseJobRow(starved)
  const due = queries.getDueMemoryJob.runSync(local.sql, { now })
  return due === null ? undefined : parseJobRow(due)
}

/**
 * Mark a queued job running as its next attempt; a running job is resumed as it is.
 *
 * @returns The current row and its parsed job, or undefined if the job is gone.
 */
export function startJob(local: LocalDb, row: JobRow): { row: JobRow; job: MemoryJob } | undefined {
  if (row.status === 'queued') {
    queries.updateStartMemoryJob.runSync(local.sql, {
      jobId: row.jobId,
      attempts: row.attempts + 1,
      startedAt: Date.now(),
    })
  }
  const current = jobRow(local, row.jobId)
  return current === undefined
    ? undefined
    : { row: current, job: parseMemoryJob(parseJsonValue(current.payloadJson)) }
}

/** Queue the job again for its next attempt at `at`. */
export function retryJob(local: LocalDb, id: string, at: number): void {
  queries.updateRetryMemoryJob.runSync(local.sql, { jobId: id, notBefore: at })
}

/** Mark a job settled with its outcome. */
export function settleJob(local: LocalDb, id: string, outcome: JobOutcome): void {
  queries.updateSettleMemoryJob.runSync(local.sql, { jobId: id, outcome, settledAt: Date.now() })
}

/** When the earliest delayed job is due, or undefined when none is queued. */
export function nextDueAt(local: LocalDb): number | undefined {
  return queries.getNextMemoryJobDue.runSync(local.sql)?.notBefore
}

/**
 * Remove settled jobs older than `before`, a batch at a time.
 *
 * @returns How many were removed; call again while it is nonzero.
 */
export function forgetSettledJobs(local: LocalDb, before: number): number {
  const old = queries.listSettledMemoryJobsBefore.runSync(local.sql, { before })
  if (old.length === 0) return 0
  const batch = old.slice(0, FORGET_BATCH).map((row) => row.jobId)
  queries.deleteMemoryJobsByIds.runSync(local.sql, { idsJson: JSON.stringify(batch) })
  return batch.length
}
