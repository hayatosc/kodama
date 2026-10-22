/**
 * The memory agent: the only writer of long-term memory (docs/memory.md, Memory agent, Jobs). It
 * is an ordinary `Agent` object with a reserved name; this role gives that object its job queue,
 * harness, and configuration. Its work can be watched like any agent's, but it takes input only
 * through the queue.
 */
import type {
  Harness,
  HarnessOptions,
  Submission,
  SubmissionDraft,
} from '@earendil-works/pi-durable'
import type { AlarmPurpose, AlarmSchedule } from '../../agent/alarms.ts'
import type { AgentEnv } from '../../env.ts'
import type { AgentConfig } from '../../protocol.ts'
import type { LocalDb } from '../../storage/local.ts'
import { needsPrune } from '../prune/runs.ts'
import { memoryDb } from '../store/db.ts'
import type { MemoryDb } from '../store/db.ts'
import { memoryLedger } from '../../../drizzle/d1/schema.ts'
import { consolidateDaily } from './consolidation.ts'
import { followMemoryModel, memoryAgentConfig, memoryHarnessOptions } from './harness.ts'
import { parseMemoryJob } from '../jobs.ts'
import type { JobOutcome, JobStatus, MemoryJob } from '../jobs.ts'
import { runModelJob } from './model-job.ts'
import { JobQueue } from './queue.ts'
import type { JobRow } from './queue.ts'

/** What the role needs from the `Agent` object it runs in. */
export interface MemoryAgentHost {
  env: AgentEnv
  storage: DurableObjectStorage
  alarms: AlarmSchedule
  harness: () => Promise<Harness>
  local: () => Promise<LocalDb>
  admit: (draft: SubmissionDraft) => Promise<Submission>
  prune: () => Promise<unknown>
}

/** While a job runs, the object wakes this often to resume it after an eviction. */
const HEARTBEAT_MS = 60_000
/** Waits before the second, third, and fourth attempt. */
export const JOB_RETRY_DELAYS_MS: readonly number[] = [60_000, 10 * 60_000, 60 * 60_000]

export class MemoryAgentRole {
  readonly #host: MemoryAgentHost
  readonly #queue: JobQueue
  #running: Promise<void> | undefined
  #again = false

  constructor(host: MemoryAgentHost) {
    this.#host = host
    this.#queue = new JobQueue(host.local)
  }

  #db(): MemoryDb {
    return memoryDb(this.#host.env.MEMORY_DB)
  }

  harnessOptions(): HarnessOptions {
    return memoryHarnessOptions(this.#host.env, () => this.#queue.running())
  }

  defaultConfig(): AgentConfig {
    return memoryAgentConfig(this.#host.env)
  }

  /** Once the harness is open: follow the configured model, then resume the queue. */
  async afterOpen(harness: Harness): Promise<void> {
    await followMemoryModel(harness, this.#host.env)
    // Not awaited: the drain waits for the open harness, which is still opening here.
    this.#kick()
  }

  async onAlarm(purpose: AlarmPurpose): Promise<void> {
    // Pruning closes the harness, so it runs between jobs, at the end of the drain.
    if (purpose === 'jobs' && this.#running !== undefined) {
      await this.#host.alarms.set('jobs', Date.now() + HEARTBEAT_MS)
    }
    this.#kick()
  }

  /** Queue a job; delivering the same job again returns its existing status. */
  async enqueue(value: unknown): Promise<JobStatus> {
    const status = await this.#queue.store(parseMemoryJob(value))
    await this.#host.alarms.setNoLaterThan('jobs', Date.now() + HEARTBEAT_MS)
    this.#kick()
    return status
  }

  jobStatus(id: string): Promise<JobStatus | undefined> {
    return this.#queue.status(id)
  }

  /** The daily consolidation, called by the scheduled handler. */
  consolidate(now: number): Promise<{ scopes: number }> {
    return consolidateDaily({
      db: this.#db(),
      forgetSettledJobs: (before) => this.#queue.forgetSettled(before),
      enqueue: (job) => this.enqueue(job),
      now,
    })
  }

  #kick(): void {
    if (this.#running !== undefined) {
      this.#again = true
      return
    }
    this.#running = this.#drain()
      .catch((error: unknown) => console.error('Memory job runner failed', error))
      .finally(() => {
        this.#running = undefined
        if (!this.#again) return
        this.#again = false
        this.#kick()
      })
  }

  /** Run jobs one at a time until none is due, then wake for the next delayed one. */
  async #drain(): Promise<void> {
    await this.#host.harness()
    for (;;) {
      const row = await this.#queue.next(Date.now())
      if (row === undefined) break
      await this.#host.alarms.set('jobs', Date.now() + HEARTBEAT_MS)
      await this.#run(row)
    }
    if (await needsPrune(this.#host.storage, await this.#host.local())) await this.#host.prune()
    await this.#host.alarms.set('jobs', await this.#queue.nextDueAt())
  }

  async #run(queued: JobRow): Promise<void> {
    const started = await this.#queue.start(queued)
    if (started === undefined) return
    const { row, job } = started
    let outcome: JobOutcome | 'retry'
    try {
      outcome = await this.#model(row, job)
    } catch (error) {
      console.error('Memory job failed', row.jobId, error)
      outcome = 'retry'
    }
    if (outcome !== 'retry') return this.#settle(row, outcome)
    const delay = JOB_RETRY_DELAYS_MS[row.attempts - 1]
    if (delay === undefined) return this.#settle(row, 'failed')
    await this.#queue.retry(row.jobId, Date.now() + delay)
  }

  async #model(row: JobRow, job: MemoryJob): Promise<JobOutcome | 'retry'> {
    const outcome = await runModelJob(
      {
        harness: await this.#host.harness(),
        admit: (draft) => this.#host.admit(draft),
        queue: this.#queue,
        db: this.#db(),
      },
      row,
      job,
    )
    if (outcome !== 'retry') await this.#notify(job)
    return outcome
  }

  async #settle(row: JobRow, outcome: JobOutcome): Promise<void> {
    await this.#queue.settle(row.jobId, outcome)
    if (outcome !== 'failed') return
    await this.#db()
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
  async #notify(job: MemoryJob): Promise<void> {
    if (!('sourceAgentId' in job)) return
    try {
      await this.#host.env.AGENTS.getByName(job.sourceAgentId).memoryChanged()
    } catch (error) {
      console.error('Memory change notice failed', job.sourceAgentId, error)
    }
  }
}
