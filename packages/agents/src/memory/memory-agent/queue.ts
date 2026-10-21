/** The memory agent's job queue in its own SQLite (docs/memory.md, Jobs). */
import { and, asc, eq, inArray, lte } from 'drizzle-orm'
import { memoryJobs } from '../../../drizzle/durable-object/schema.ts'
import type { LocalDb } from '../../storage/local.ts'
import { JOB_PRIORITY, jobId, parseMemoryJob } from './jobs.ts'
import type { JobOutcome, JobStatus, MemoryJob } from './jobs.ts'
import type { RunningJob } from './tools/common.ts'

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

/** Settled jobs removed per call. */
const FORGET_BATCH = 500

/**
 * At most one job is `running`. The object's SQLite runs each call synchronously, so a row read
 * here is still current when the next call writes it.
 */
export class JobQueue {
  readonly #local: () => Promise<LocalDb>

  constructor(local: () => Promise<LocalDb>) {
    this.#local = local
  }

  async #row(id: string): Promise<JobRow | undefined> {
    const local = await this.#local()
    return local.select().from(memoryJobs).where(eq(memoryJobs.jobId, id)).get()
  }

  /** Queue a job once; the same job delivered again finds the first. */
  async store(job: MemoryJob): Promise<JobStatus> {
    const id = await jobId(job)
    const local = await this.#local()
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
    const row = await this.#row(id)
    if (row === undefined) throw new Error('Job was not stored')
    return toStatus(row)
  }

  async status(id: string): Promise<JobStatus | undefined> {
    const row = await this.#row(id)
    return row === undefined ? undefined : toStatus(row)
  }

  /** The running job, for the memory tools. */
  async running(): Promise<RunningJob | undefined> {
    const local = await this.#local()
    const row = local.select().from(memoryJobs).where(eq(memoryJobs.status, 'running')).get()
    return row === undefined
      ? undefined
      : { jobId: row.jobId, job: parseMemoryJob(JSON.parse(row.payloadJson)) }
  }

  /** The running job to resume, else the next queued job that is due. */
  async next(now: number): Promise<JobRow | undefined> {
    const local = await this.#local()
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

  /** Mark a queued job running as its next attempt; a running job is resumed as it is. */
  async start(row: JobRow): Promise<{ row: JobRow; job: MemoryJob } | undefined> {
    const local = await this.#local()
    if (row.status === 'queued') {
      local
        .update(memoryJobs)
        .set({ status: 'running', attempts: row.attempts + 1, submissionId: null })
        .where(eq(memoryJobs.jobId, row.jobId))
        .run()
    }
    const current = await this.#row(row.jobId)
    return current === undefined
      ? undefined
      : { row: current, job: parseMemoryJob(JSON.parse(current.payloadJson)) }
  }

  async recordSubmission(id: string, submissionId: number): Promise<void> {
    const local = await this.#local()
    local.update(memoryJobs).set({ submissionId }).where(eq(memoryJobs.jobId, id)).run()
  }

  /** Queue the job again for its next attempt at `at`. */
  async retry(id: string, at: number): Promise<void> {
    const local = await this.#local()
    local
      .update(memoryJobs)
      .set({ status: 'queued', notBefore: at })
      .where(eq(memoryJobs.jobId, id))
      .run()
  }

  async settle(id: string, outcome: JobOutcome): Promise<void> {
    const local = await this.#local()
    local
      .update(memoryJobs)
      .set({ status: 'settled', outcome, settledAt: Date.now() })
      .where(eq(memoryJobs.jobId, id))
      .run()
  }

  /** When the earliest delayed job is due, if any is queued. */
  async nextDueAt(): Promise<number | undefined> {
    const local = await this.#local()
    return local
      .select({ notBefore: memoryJobs.notBefore })
      .from(memoryJobs)
      .where(eq(memoryJobs.status, 'queued'))
      .orderBy(asc(memoryJobs.notBefore))
      .limit(1)
      .get()?.notBefore
  }

  /** Settled jobs older than `before`, removed in small batches. */
  async forgetSettled(before: number): Promise<number> {
    const local = await this.#local()
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
}
