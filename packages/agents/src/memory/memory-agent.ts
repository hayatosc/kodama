/**
 * The memory agent: the only writer of long-term memory (docs/design/long-term-memory.md, Memory
 * agent, Jobs). It inherits `Agent`, so its work can be watched like any agent's, but takes input
 * only through its job queue.
 */
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  configure,
  createRegistry,
  defineExtension,
  ROOT_CONVERSATION_ID,
} from '@earendil-works/pi-durable'
import type { Harness, HarnessOptions, Submission } from '@earendil-works/pi-durable'
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm'
import * as v from 'valibot'
import { Agent } from '../agent.ts'
import type { AlarmPurpose } from '../alarms.ts'
import type { AgentEnv } from '../env.ts'
import { harnessSettings } from '../harness.ts'
import { createAgentModels } from '../models/index.ts'
import type { AgentConfig, SendMessageRequest, SendMessageResponse } from '../protocol.ts'
import { memoryJobs } from '../storage/local-schema.ts'
import { isCodeJob, JOB_PRIORITY, jobId, parseMemoryJob } from './jobs.ts'
import type { JobOutcome, JobStatus, MemoryJob } from './jobs.ts'
import { createMemoryAgentTools } from './memory-tools.ts'
import type { RunningJob } from './memory-tools.ts'
import { jobPrompt, MEMORY_SYSTEM_PROMPT } from './prompts.ts'
import { needsPrune } from './prune.ts'
import { memoryDb } from './records.ts'
import { memoryLedger, memoryOps } from './schema.ts'

const context = BACKGROUND_CONTEXT
/** While a job runs, the object wakes this often to resume it after an eviction. */
const HEARTBEAT_MS = 60_000
/** Waits before the second, third, and fourth attempt. */
export const JOB_RETRY_DELAYS_MS: readonly number[] = [60_000, 10 * 60_000, 60 * 60_000]

/** The memory agent's model: `MEMORY_MODEL_*`, or the default model when they are empty. */
export function memoryModel(env: AgentEnv): { provider: string; modelId: string } {
  return {
    provider: env.MEMORY_MODEL_PROVIDER || env.DEFAULT_MODEL_PROVIDER,
    modelId: env.MEMORY_MODEL_ID || env.DEFAULT_MODEL_ID,
  }
}

const resultStatusSchema = v.object({ status: v.string() })

/** A job's outcome from the operations it applied. */
function outcomeOf(results: readonly string[]): JobOutcome {
  const statuses = results.flatMap((json) => {
    const parsed = v.safeParse(resultStatusSchema, JSON.parse(json))
    return parsed.success ? [parsed.output.status] : []
  })
  if (statuses.includes('applied')) return 'persisted'
  return 'declined'
}

type JobRow = typeof memoryJobs.$inferSelect

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

export class MemoryAgent extends Agent {
  #running: Promise<void> | undefined
  #again = false

  constructor(ctx: DurableObjectState, env: AgentEnv) {
    super(ctx, env)
    void this.harness().then(() => this.#kick())
  }

  protected override harnessOptions(): HarnessOptions {
    const extension = defineExtension({
      name: 'kodama-memory-agent',
      tools: createMemoryAgentTools({ env: this.env, runningJob: () => this.runningJob() }),
    })
    const registry = createRegistry()
    registry.install(extension)
    const model = memoryModel(this.env)
    return {
      models: createAgentModels(this.env),
      registry,
      settings: harnessSettings([extension]),
      conversationCreated: (tx, conversation) =>
        conversation.owner === undefined && conversation.parent === undefined
          ? configure(tx, conversation.id, {
              model,
              instructions: MEMORY_SYSTEM_PROMPT,
              thinkingLevel: 'off',
            })
          : undefined,
    }
  }

  protected override defaultConfig(): AgentConfig {
    return {
      model: memoryModel(this.env),
      systemPrompt: MEMORY_SYSTEM_PROMPT,
      thinkingLevel: 'off',
      tools: [],
    }
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
    const job = parseMemoryJob(value)
    const id = await jobId(job)
    const local = await this.local()
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
    await this.alarms.setNoLaterThan('jobs', Date.now() + HEARTBEAT_MS)
    this.#kick()
    const row = local.select().from(memoryJobs).where(eq(memoryJobs.jobId, id)).get()
    if (row === undefined) throw new Error('Job was not stored')
    return toStatus(row)
  }

  async jobStatus(id: string): Promise<JobStatus | undefined> {
    const local = await this.local()
    const row = local.select().from(memoryJobs).where(eq(memoryJobs.jobId, id)).get()
    return row === undefined ? undefined : toStatus(row)
  }

  /** The running job, for the memory tools. */
  protected async runningJob(): Promise<RunningJob | undefined> {
    const local = await this.local()
    const row = local.select().from(memoryJobs).where(eq(memoryJobs.status, 'running')).get()
    return row === undefined
      ? undefined
      : { jobId: row.jobId, job: parseMemoryJob(JSON.parse(row.payloadJson)) }
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

  /** The running job to resume, else the next queued job that is due. */
  async #next(now: number): Promise<JobRow | undefined> {
    const local = await this.local()
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

  /** Run jobs one at a time until none is due, then wake for the next delayed one. */
  async #drain(): Promise<void> {
    await this.harness()
    for (;;) {
      const row = await this.#next(Date.now())
      if (row === undefined) break
      await this.alarms.set('jobs', Date.now() + HEARTBEAT_MS)
      await this.#run(row)
    }
    const local = await this.local()
    if (await needsPrune(this.ctx.storage, local)) await this.prune()
    const delayed = local
      .select({ notBefore: memoryJobs.notBefore })
      .from(memoryJobs)
      .where(eq(memoryJobs.status, 'queued'))
      .orderBy(asc(memoryJobs.notBefore))
      .limit(1)
      .get()
    await this.alarms.set('jobs', delayed?.notBefore)
  }

  async #run(row: JobRow): Promise<void> {
    const local = await this.local()
    if (row.status === 'queued') {
      local
        .update(memoryJobs)
        .set({ status: 'running', attempts: sql`${memoryJobs.attempts} + 1`, submissionId: null })
        .where(eq(memoryJobs.jobId, row.jobId))
        .run()
    }
    const current = local.select().from(memoryJobs).where(eq(memoryJobs.jobId, row.jobId)).get()
    if (current === undefined) return
    const job = parseMemoryJob(JSON.parse(current.payloadJson))
    let outcome: JobOutcome | 'retry'
    try {
      outcome = isCodeJob(job)
        ? await this.runCodeJob(current.jobId, job)
        : await this.#runModelJob(current, job)
    } catch (error) {
      console.error('Memory job failed', current.jobId, error)
      outcome = 'retry'
    }
    if (outcome !== 'retry') return this.#settle(current, outcome)
    const delay = JOB_RETRY_DELAYS_MS[current.attempts - 1]
    if (delay === undefined) return this.#settle(current, 'failed')
    local
      .update(memoryJobs)
      .set({ status: 'queued', notBefore: Date.now() + delay })
      .where(eq(memoryJobs.jobId, current.jobId))
      .run()
  }

  async #settle(row: JobRow, outcome: JobOutcome): Promise<void> {
    const local = await this.local()
    local
      .update(memoryJobs)
      .set({ status: 'settled', outcome, settledAt: Date.now() })
      .where(eq(memoryJobs.jobId, row.jobId))
      .run()
    if (outcome !== 'failed') return
    await memoryDb(this.env.MEMORY_DB)
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

  /** Each attempt is its own Pi input, started from a fresh context. */
  async #runModelJob(row: JobRow, job: MemoryJob): Promise<JobOutcome | 'retry'> {
    const harness = await this.harness()
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
      submission = await this.admit({
        type: 'input',
        requestId,
        content: jobPrompt(job),
        whenBusy: 'followUp',
      })
      const local = await this.local()
      local
        .update(memoryJobs)
        .set({ submissionId: submission.id })
        .where(eq(memoryJobs.jobId, row.jobId))
        .run()
    }
    const settled = await submission.wait(context)
    if (settled.status !== 'done') return 'retry'
    const ops = await memoryDb(this.env.MEMORY_DB)
      .select({ resultJson: memoryOps.resultJson })
      .from(memoryOps)
      .where(eq(memoryOps.jobId, row.jobId))
    await this.#notify(job)
    return outcomeOf(ops.map((op) => op.resultJson))
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

  /** Jobs that run in code; shared-memory proposals add theirs. */
  protected runCodeJob(_jobId: string, job: MemoryJob): Promise<JobOutcome | 'retry'> {
    return Promise.reject(new Error(`No code runner for ${job.kind}`))
  }

  /** Settled jobs older than `before`, removed in small batches. */
  async forgetSettledJobs(before: number): Promise<number> {
    const local = await this.local()
    const old = local
      .select({ jobId: memoryJobs.jobId })
      .from(memoryJobs)
      .where(and(eq(memoryJobs.status, 'settled'), lte(memoryJobs.settledAt, before)))
      .limit(500)
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
