/**
 * The memory agent: the only writer of long-term memory (docs/memory.md, Memory
 * agent, Jobs). It inherits `Agent`, so its work can be watched like any agent's, but takes input
 * only through its job queue. This class runs the queue; the parts live next to it.
 */
import type { Harness, HarnessOptions } from '@earendil-works/pi-durable'
import { Agent } from '../../agent/agent.ts'
import type { AlarmPurpose } from '../../alarms.ts'
import type { AgentEnv } from '../../env.ts'
import type { AgentConfig, SendMessageRequest, SendMessageResponse } from '../../protocol.ts'
import { needsPrune } from '../prune/runs.ts'
import { acceptedProposals, applyProposal } from '../shared/apply.ts'
import { finishPendingSkillWrites } from '../skills/write.ts'
import { memoryDb } from '../store/db.ts'
import type { MemoryDb } from '../store/db.ts'
import { memoryLedger } from '../../../drizzle/d1/schema/records.ts'
import { consolidateDaily } from './consolidation.ts'
import { memoryAgentConfig, memoryHarnessOptions } from './harness.ts'
import { isCodeJob, parseMemoryJob } from './jobs.ts'
import type { JobOutcome, JobStatus, MemoryJob } from './jobs.ts'
import { runModelJob } from './model-job.ts'
import { JobQueue } from './queue.ts'
import type { JobRow } from './queue.ts'
import type { RunningJob } from './tools/common.ts'

/** While a job runs, the object wakes this often to resume it after an eviction. */
const HEARTBEAT_MS = 60_000
/** Waits before the second, third, and fourth attempt. */
export const JOB_RETRY_DELAYS_MS: readonly number[] = [60_000, 10 * 60_000, 60 * 60_000]

export class MemoryAgent extends Agent {
  readonly #queue = new JobQueue(() => this.local())
  #running: Promise<void> | undefined
  #again = false

  constructor(ctx: DurableObjectState, env: AgentEnv) {
    super(ctx, env)
    void this.harness().then(() => this.#kick())
  }

  #db(): MemoryDb {
    return memoryDb(this.env.MEMORY_DB)
  }

  protected override harnessOptions(): HarnessOptions {
    return memoryHarnessOptions(this.env, () => this.runningJob())
  }

  protected override defaultConfig(): AgentConfig {
    return memoryAgentConfig(this.env)
  }

  /** The memory agent keeps no memory of its own and extracts nothing. */
  protected override async afterOpen(_harness: Harness): Promise<void> {}

  protected override async onIdle(): Promise<void> {}

  /** The memory agent's own history is job scratch work: pruning deletes it without an archive. */
  protected override archivesEntries(): boolean {
    return false
  }

  protected override async onAlarm(purpose: AlarmPurpose): Promise<void> {
    // Pruning closes the harness, so it runs between jobs, at the end of the drain.
    if (purpose === 'prune') return this.#kick()
    if (purpose !== 'jobs') return super.onAlarm(purpose)
    if (this.#running !== undefined) await this.alarms.set('jobs', Date.now() + HEARTBEAT_MS)
    this.#kick()
  }

  override sendMessage(_request: SendMessageRequest): Promise<number> {
    return Promise.reject(new Error('The memory agent takes jobs through enqueue'))
  }

  override sendTo(_agentId: string, _request: SendMessageRequest): Promise<SendMessageResponse> {
    return Promise.reject(new Error('The memory agent does not message other agents'))
  }

  override setConfig(_value: AgentConfig): Promise<AgentConfig> {
    return Promise.reject(new Error('The memory agent configuration is fixed in code'))
  }

  /** Queue a job; delivering the same job again returns its existing status. */
  async enqueue(value: unknown): Promise<JobStatus> {
    const status = await this.#queue.store(parseMemoryJob(value))
    await this.alarms.setNoLaterThan('jobs', Date.now() + HEARTBEAT_MS)
    this.#kick()
    return status
  }

  jobStatus(id: string): Promise<JobStatus | undefined> {
    return this.#queue.status(id)
  }

  /** The running job, for the memory tools. */
  protected runningJob(): Promise<RunningJob | undefined> {
    return this.#queue.running()
  }

  /** Settled jobs older than `before`, removed in small batches. */
  forgetSettledJobs(before: number): Promise<number> {
    return this.#queue.forgetSettled(before)
  }

  /** The daily consolidation, called by the scheduled handler. */
  consolidate(now: number): Promise<{ scopes: number }> {
    return consolidateDaily({
      db: this.#db(),
      bucket: this.env.ARCHIVE,
      forgetSettledJobs: (before) => this.forgetSettledJobs(before),
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
    await this.harness()
    for (;;) {
      // An accepted proposal is durable pending work: queued between jobs, so one the running
      // job wrote is applied next.
      for (const proposal of await acceptedProposals(this.#db())) {
        await this.#queue.store({ kind: 'apply_proposal', proposalId: proposal.id })
      }
      const row = await this.#queue.next(Date.now())
      if (row === undefined) break
      await this.alarms.set('jobs', Date.now() + HEARTBEAT_MS)
      // A skill write a stop left half done is finished before anything reads the skill again.
      await finishPendingSkillWrites(this.#db(), this.env.ARCHIVE, Date.now())
      await this.#run(row)
    }
    if (await needsPrune(this.ctx.storage, await this.local())) await this.prune()
    await this.alarms.set('jobs', await this.#queue.nextDueAt())
  }

  async #run(queued: JobRow): Promise<void> {
    const started = await this.#queue.start(queued)
    if (started === undefined) return
    const { row, job } = started
    let outcome: JobOutcome | 'retry'
    try {
      outcome = isCodeJob(job) ? await this.runCodeJob(row.jobId, job) : await this.#model(row, job)
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
        harness: await this.harness(),
        admit: (draft) => this.admit(draft),
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
      await this.env.AGENTS.getByName(job.sourceAgentId).memoryChanged()
    } catch (error) {
      console.error('Memory change notice failed', job.sourceAgentId, error)
    }
  }

  /** Jobs that run in code, without the model. */
  protected runCodeJob(_jobId: string, job: MemoryJob): Promise<JobOutcome | 'retry'> {
    if (job.kind !== 'apply_proposal') {
      return Promise.reject(new Error(`No code runner for ${job.kind}`))
    }
    return applyProposal(
      {
        db: this.#db(),
        bucket: this.env.ARCHIVE,
        sharedSpacesOf: async (agentId) =>
          (await this.env.AGENTS.getByName(agentId).getConfig()).sharedSpaces,
        now: Date.now(),
      },
      job.proposalId,
    )
  }
}
