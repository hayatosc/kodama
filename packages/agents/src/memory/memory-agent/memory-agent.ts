/**
 * The memory agent: the only writer of long-term memory (docs/memory.md, Memory agent, Jobs). It
 * is an ordinary `Agent` object with a reserved name; these functions run its job queue. The
 * object keeps one drain running at a time and calls `drainJobs` again when more work arrives.
 */
import type { Harness, Submission, SubmissionDraft } from '@earendil-works/pi-durable'
import { memoryLedger } from '../../../drizzle/d1/schema.ts'
import { setAlarm, setAlarmNoLaterThan } from '../../agent/alarms.ts'
import type { AgentEnv } from '../../env.ts'
import type { LocalDb } from '../../storage/local.ts'
import { parseMemoryJob } from '../jobs.ts'
import type { JobOutcome, JobStatus, MemoryJob } from '../jobs.ts'
import { needsPrune } from '../prune/runs.ts'
import { memoryDb } from '../store/db.ts'
import { consolidateDaily } from './consolidation.ts'
import { runModelJob } from './model-job.ts'
import {
  forgetSettledJobs,
  nextDueAt,
  nextJob,
  retryJob,
  settleJob,
  startJob,
  storeJob,
} from './queue.ts'
import type { JobRow } from './queue.ts'

/** While a job runs, the object wakes this often to resume it after an eviction. */
export const HEARTBEAT_MS = 60_000
/** Waits before the second, third, and fourth attempt. */
export const JOB_RETRY_DELAYS_MS: readonly number[] = [60_000, 10 * 60_000, 60 * 60_000]

/** What the jobs need from the `Agent` object they run in. */
export interface MemoryAgentContext {
  env: AgentEnv
  storage: DurableObjectStorage
  harness: () => Promise<Harness>
  local: () => Promise<LocalDb>
  admit: (draft: SubmissionDraft) => Promise<Submission>
  prune: () => Promise<unknown>
}

/** Queue a job and make sure the `jobs` alarm wakes the object; the caller starts the drain. */
export async function enqueueJob(ctx: MemoryAgentContext, value: unknown): Promise<JobStatus> {
  const status = await storeJob(await ctx.local(), parseMemoryJob(value))
  await setAlarmNoLaterThan(ctx.storage, 'jobs', Date.now() + HEARTBEAT_MS)
  return status
}

/** The daily consolidation, called by the scheduled handler. */
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
 * Run jobs one at a time until none is due, then wake for the next delayed one. Pruning closes the
 * harness, so it runs here, between jobs. The caller never runs two drains at once.
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
