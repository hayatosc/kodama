/**
 * How the memory agent takes its input: one job at a time from its queue.
 *
 * The `MemoryAgent` object keeps one drain running and starts it again when a job is queued or its
 * alarm fires. Each job is one Pi input in a fresh context.
 *
 * @see docs/memory.md — Jobs
 *
 * @module
 */
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import type { Harness, Submission, SubmissionDraft } from '@earendil-works/pi-durable'
import { eq } from 'drizzle-orm'
import * as v from 'valibot'
import { memoryLedger, memoryOps } from '../../../drizzle/memory/schema.ts'
import type { AgentEnv } from '../../env.ts'
import { consolidateDaily } from '../../memory/consolidation.ts'
import { parseMemoryJob } from '../../memory/jobs.ts'
import type { JobOutcome, JobStatus, MemoryJob } from '../../memory/jobs.ts'
import { needsPrune } from '../../memory/prune/runs.ts'
import { memoryDb, extractionCheckpoint } from '../../memory/store/db.ts'
import type { MemoryDb } from '../../memory/store/db.ts'
import type { LocalDb } from '../../storage/local.ts'
import { setAlarm, setAlarmNoLaterThan } from '../../runtime/alarms.ts'
import { jobPrompt } from './config.ts'
import {
  forgetSettledJobs,
  nextDueAt,
  nextJob,
  recordSubmission,
  retryJob,
  settleJob,
  startJob,
  storeJob,
} from './queue.ts'
import type { JobRow } from './queue.ts'

const context = BACKGROUND_CONTEXT

/** While a job runs, the object wakes this often, so the job resumes after an eviction. */
export const HEARTBEAT_MS = 60_000
/**
 * Waits before the second, third, and fourth attempt; a job that fails a fourth time settles `failed`.
 */
export const JOB_RETRY_DELAYS_MS: readonly number[] = [60_000, 10 * 60_000, 60 * 60_000]

/** What the job functions need from the `MemoryAgent` object they run in. */
export interface MemoryAgentContext {
  env: AgentEnv
  storage: DurableObjectStorage
  harness: () => Promise<Harness>
  local: () => Promise<LocalDb>
  admit: (draft: SubmissionDraft) => Promise<Submission>
  prune: () => Promise<unknown>
}

/**
 * Queue a job and make sure the `jobs` alarm wakes the object. The caller starts the drain.
 *
 * @returns The job's status; the same job delivered again returns the existing one.
 * @throws {@link TypeError} When `value` is not a valid memory job.
 */
export async function enqueueJob(ctx: MemoryAgentContext, value: unknown): Promise<JobStatus> {
  const job = parseMemoryJob(value)
  const checkpoint =
    job.kind === 'extract'
      ? await extractionCheckpoint(memoryDb(ctx.env.MEMORY_DB), job.sourceAgentId)
      : undefined
  const status = await storeJob(await ctx.local(), job, checkpoint)
  await setAlarmNoLaterThan(ctx.storage, 'jobs', Date.now() + HEARTBEAT_MS)
  return status
}

/**
 * The daily consolidation, called by the scheduled handler.
 *
 * @param enqueue - Queues one `consolidate` job, and starts the drain.
 */
export function consolidate(
  ctx: MemoryAgentContext,
  now: number,
  enqueue: (job: MemoryJob) => Promise<unknown>,
): Promise<{ scopes: number }> {
  return consolidateDaily({
    db: memoryDb(ctx.env.MEMORY_DB),
    forgetSettledJobs: async (before) => forgetSettledJobs(await ctx.local(), before),
    enqueue,
    now,
  })
}

/**
 * Run jobs one at a time until none is due, then set the alarm for the next delayed one.
 *
 * @remarks
 * Pruning closes the harness, so it runs here, between jobs. The caller never runs two drains at
 * once.
 */
export async function drainJobs(ctx: MemoryAgentContext): Promise<void> {
  await ctx.harness()
  for (;;) {
    const row = nextJob(await ctx.local(), Date.now())
    if (row === undefined) break
    await setAlarm(ctx.storage, 'jobs', Date.now() + HEARTBEAT_MS)
    await runJob(ctx, row)
  }
  const local = await ctx.local()
  if (await needsPrune(ctx.storage, local)) await ctx.prune()
  await setAlarm(ctx.storage, 'jobs', nextDueAt(await ctx.local()))
}

async function runJob(ctx: MemoryAgentContext, queued: JobRow): Promise<void> {
  const local = await ctx.local()
  const started = startJob(local, queued)
  if (started === undefined) return
  const { row, job } = started
  let outcome: JobOutcome | 'retry'
  try {
    outcome = await runModelJob(
      { harness: await ctx.harness(), admit: ctx.admit, local, db: memoryDb(ctx.env.MEMORY_DB) },
      row,
      job,
    )
    if (outcome !== 'retry') await notifySource(ctx, job)
  } catch (error) {
    console.error('Memory job failed', row.jobId, error)
    outcome = 'retry'
  }
  if (outcome !== 'retry') return settle(ctx, row, outcome)
  const delay = JOB_RETRY_DELAYS_MS[row.attempts - 1]
  if (delay === undefined) return settle(ctx, row, 'failed')
  retryJob(local, row.jobId, Date.now() + delay)
}

async function settle(ctx: MemoryAgentContext, row: JobRow, outcome: JobOutcome): Promise<void> {
  settleJob(await ctx.local(), row.jobId, outcome)
  if (outcome !== 'failed') return
  await memoryDb(ctx.env.MEMORY_DB)
    .insert(memoryLedger)
    .values({
      at: Date.now(),
      runId: row.jobId,
      actor: 'memory-agent',
      action: 'job_failed',
      target: 'record',
      targetId: row.jobId,
      detailJson: JSON.stringify({ kind: row.kind, attempts: row.attempts }),
    })
}

/** Tell the source agent its memory may have changed; a lost notice only delays its refresh. */
async function notifySource(ctx: MemoryAgentContext, job: MemoryJob): Promise<void> {
  if (!('sourceAgentId' in job)) return
  try {
    await ctx.env.AGENTS.getByName(job.sourceAgentId).memoryChanged()
  } catch (error) {
    console.error('Memory change notice failed', job.sourceAgentId, error)
  }
}

/** What one model job needs. */
export interface ModelJobDeps {
  harness: Harness
  admit: (draft: SubmissionDraft) => Promise<Submission>
  local: LocalDb
  db: MemoryDb
}

const resultStatusSchema = v.object({ status: v.string() })

/** A job's outcome from the operations it applied. */
function outcomeOf(results: readonly string[]): JobOutcome {
  const statuses = results.flatMap((json) => {
    const parsed = v.safeParse(resultStatusSchema, JSON.parse(json))
    return parsed.success ? [parsed.output.status] : []
  })
  return statuses.includes('applied') ? 'persisted' : 'declined'
}

/**
 * Run one attempt of a job as a Pi input, and derive its outcome from the operations it applied.
 *
 * @returns `retry` when the submission did not finish with an answer.
 *
 * @remarks
 * The conversation is reset while idle first, so the job starts without the previous job's
 * context. A resumed attempt finds its submission by request ID and waits for it instead of
 * submitting again.
 */
export async function runModelJob(
  deps: ModelJobDeps,
  row: JobRow,
  job: MemoryJob,
): Promise<JobOutcome | 'retry'> {
  const { harness } = deps
  const requestId = `${row.jobId}-${row.attempts}`
  const root = await harness.root(context)
  const existing = await harness.commit(
    (tx) => tx.submissionByRequest(ROOT_CONVERSATION_ID, requestId),
    context,
  )
  let submission: Submission | undefined =
    existing === undefined ? undefined : await harness.submission(existing.id, context)
  if (submission === undefined) {
    await root.waitForIdle(context)
    // Placed at once while idle, so the job starts without the previous job's context.
    await root.reset(undefined, context)
    submission = await deps.admit({
      type: 'input',
      requestId,
      content: jobPrompt(job),
      whenBusy: 'followUp',
    })
    recordSubmission(deps.local, row.jobId, submission.id)
  }
  const settled = await submission.wait(context)
  if (settled.status !== 'done') return 'retry'
  const ops = await deps.db
    .select({ resultJson: memoryOps.resultJson })
    .from(memoryOps)
    .where(eq(memoryOps.jobId, row.jobId))
  return outcomeOf(ops.map((op) => op.resultJson))
}
