import { DurableObject } from 'cloudflare:workers'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type {
  Harness,
  HarnessOptions,
  Submission,
  SubmissionDraft,
  TaskId,
} from '@earendil-works/pi-durable'
import { setAlarm, takeDueAlarms } from './alarms.ts'
import type { AlarmPurpose } from './alarms.ts'
import {
  defaultAgentConfig,
  initializeAgentConfig,
  readSharedSpaces,
} from '../configuration/index.ts'
import type { AgentEnv } from '../env.ts'
import { coalescingRunner, serialQueue } from '../lib/serial.ts'
import { sendEvents, subscribeEvents } from './events.ts'
import { createAgentOptions } from './harness.ts'
import { memoryDb } from '../memory/store/db.ts'
import type { PruneDeps, PruneOutcome } from '../memory/prune/prune.ts'
import { MEMORY_AGENT_NAME } from '../memory/jobs.ts'
import type { JobStatus } from '../memory/jobs.ts'
import {
  consolidate,
  drainJobs,
  enqueueJob,
  HEARTBEAT_MS,
} from '../memory/memory-agent/memory-agent.ts'
import type { MemoryAgentContext } from '../memory/memory-agent/memory-agent.ts'
import {
  followMemoryModel,
  memoryAgentConfig,
  memoryHarnessOptions,
} from '../memory/memory-agent/harness.ts'
import { jobStatus, runningJob } from '../memory/memory-agent/queue.ts'
import { createWorkingMemoryExtension } from '../memory/working/extension.ts'
import type { WorkingMemoryDeps } from '../memory/working/deps.ts'
import { createAgentModels } from '../models/index.ts'
import type {
  AgentConfig,
  AgentSnapshot,
  SendMessageRequest,
  SendMessageResponse,
  SubmissionStatus,
} from '../protocol.ts'
import { armRecovery, refreshRecovery } from './recovery.ts'
import { openLocalDb } from '../storage/local.ts'
import type { LocalDb } from '../storage/local.ts'
import { parseAgentId, parseMessage, parseRequestId } from '../validation.ts'
import { readEntries } from './entries.ts'
import type { EntryPage } from './entries.ts'
import { readConfig, replaceConfig } from './config.ts'
import type { ConfigStore } from './config.ts'
import { pruneUntilUnder, refuseWhenFull, schedulePruneIfNeeded } from './maintenance.ts'
import { EXTRACT_IDLE_DELAY_MS, extractNewEntries, refreshMemory } from './memory.ts'
import { exclusiveSection, isIdle, openHarness } from './session.ts'
import { snapshotOf, submissionOf } from './views.ts'

const context = BACKGROUND_CONTEXT

/**
 * One named object owns one agent and its durable Pi session. This class serves RPC and holds the
 * object's in-memory state; the work is done by functions in this folder and in `src/memory/`.
 *
 * The memory agent is one of these objects too, under the reserved name `MEMORY_AGENT_NAME`. It
 * uses the memory agent's harness and configuration, and runs a job queue instead of taking chat
 * input. The name is not a valid public agent ID, so `AgentService` cannot reach it.
 */
export class Agent extends DurableObject<AgentEnv> {
  readonly #isMemoryAgent: boolean
  readonly #local: Promise<LocalDb>
  /** The open harness; replaced when pruning closes and reopens it. */
  #harness: Promise<Harness>
  /** Alarm updates and admissions that depend on them run one at a time. */
  readonly #serial = serialQueue()
  /** Tasks the recovery alarm already watches. */
  readonly #watching = new Set<TaskId>()
  /** The pruning pass in progress; concurrent calls share it. */
  #pruning: Promise<PruneOutcome> | undefined
  /** A memory change arrived while busy; refresh at the next idle moment. */
  #memoryChanged = false
  /** The memory agent's job drain, one at a time. */
  readonly #jobs = coalescingRunner(
    () => drainJobs(this.#memoryAgentContext()),
    'Memory job runner failed',
  )

  constructor(ctx: DurableObjectState, env: AgentEnv) {
    super(ctx, env)
    this.#isMemoryAgent = ctx.id.name === MEMORY_AGENT_NAME
    this.#local = openLocalDb(ctx.storage)
    // Every request waits until the harness is open and prepared.
    this.#harness = ctx.blockConcurrencyWhile(async () => {
      await this.#local
      return this.#open()
    })
  }

  #open(): Promise<Harness> {
    return openHarness(this.ctx, this.#harnessOptions(), async (harness) => {
      await harness.root(context)
      await initializeAgentConfig(harness, this.#defaultConfig())
      if (this.#isMemoryAgent) {
        await followMemoryModel(harness, this.env)
        // Not awaited: the drain waits for the harness, which is still opening here.
        this.#jobs.start()
      } else {
        await refreshMemory(this.#workingMemory())
      }
      await this.#refreshRecovery(harness)
    })
  }

  /** This agent's ID, the name its object was created with. */
  #agentId(): string {
    const name = this.ctx.id.name
    if (name === undefined) throw new Error('Agents are addressed by name')
    return name
  }

  /** Reject chat input and configuration on the memory agent, whose input is its job queue. */
  #workingOnly(action: string): void {
    if (this.#isMemoryAgent) {
      throw new Error(`The memory agent does not ${action}; it takes jobs through enqueue`)
    }
  }

  #memoryAgentOnly(): void {
    if (!this.#isMemoryAgent) throw new Error('Only the memory agent takes jobs')
  }

  #workingMemory(): WorkingMemoryDeps {
    return {
      env: this.env,
      agentId: () => this.#agentId(),
      local: () => this.#local,
      sharedSpaces: () => this.#sharedSpaces(),
    }
  }

  #memoryAgentContext(): MemoryAgentContext {
    return {
      env: this.env,
      storage: this.ctx.storage,
      harness: () => this.#harness,
      local: () => this.#local,
      admit: (draft) => this.#admit(draft),
      prune: () => this.prune(),
    }
  }

  /** Called on every open, so a changed registry or setting applies after eviction. */
  #harnessOptions(): HarnessOptions {
    if (this.#isMemoryAgent) {
      return memoryHarnessOptions(this.env, async () => runningJob(await this.#local))
    }
    return createAgentOptions(this.env, [createWorkingMemoryExtension(this.#workingMemory())])
  }

  #defaultConfig(): AgentConfig {
    return this.#isMemoryAgent ? memoryAgentConfig(this.env) : defaultAgentConfig(this.env)
  }

  async #config(): Promise<ConfigStore> {
    return {
      harness: await this.#harness,
      storage: this.ctx.storage,
      defaults: this.#defaultConfig(),
    }
  }

  #sharedSpaces(): Promise<string[]> {
    return readSharedSpaces(this.ctx.storage, this.#defaultConfig().sharedSpaces)
  }

  #pruneDeps(): PruneDeps {
    return {
      storage: this.ctx.storage,
      env: this.env,
      agentId: () => this.#agentId(),
      local: () => this.#local,
      harness: () => this.#harness,
      exclusive: (check, mutate) => this.#exclusive(check, mutate),
      // The memory agent's history is job scratch work: pruning deletes it without an archive.
      archive: !this.#isMemoryAgent,
      memoryAgent: () => this.env.AGENTS.getByName(MEMORY_AGENT_NAME),
    }
  }

  /** Close the harness for `mutate` if `check` passes, then reopen it; see `exclusiveSection`. */
  async #exclusive(check: (harness: Harness) => Promise<boolean>, mutate: () => void) {
    const section = exclusiveSection(this.ctx, this.#harness, check, mutate, () => this.#open())
    this.#harness = section.then((result) => result.harness)
    return (await section).mutated
  }

  /** Keep the recovery alarm in step with Pi's tasks; runs in the serial queue. */
  #refreshRecovery(harness: Harness): Promise<void> {
    return this.#serial(() =>
      refreshRecovery({
        harness,
        storage: this.ctx.storage,
        watching: this.#watching,
        onIdle: () => this.#onIdle(),
        refreshAgain: () => this.#refreshRecovery(harness),
      }),
    )
  }

  /** Runs whenever Pi has no runnable task left. The memory agent prunes between its jobs. */
  async #onIdle(): Promise<void> {
    if (this.#isMemoryAgent) return
    await setAlarm(this.ctx.storage, 'extract', Date.now() + EXTRACT_IDLE_DELAY_MS)
    await schedulePruneIfNeeded(this.ctx.storage, await this.#local)
    if (!this.#memoryChanged) return
    this.#memoryChanged = false
    await refreshMemory(this.#workingMemory())
  }

  async #onAlarm(purpose: AlarmPurpose): Promise<void> {
    if (this.#isMemoryAgent) {
      // While a job runs, keep waking so the job resumes after an eviction.
      if (purpose === 'jobs' && this.#jobs.running()) {
        await setAlarm(this.ctx.storage, 'jobs', Date.now() + HEARTBEAT_MS)
      }
      // Pruning closes the harness, so the drain runs it between jobs.
      this.#jobs.start()
      return
    }
    if (purpose === 'extract') {
      const harness = await this.#harness
      if (await isIdle(harness)) await extractNewEntries(this.#workingMemory(), harness)
    }
    if (purpose === 'prune') await this.prune()
  }

  override async alarm(): Promise<void> {
    // Take due purposes first: the recovery refresh reschedules extraction when it finds the agent idle.
    const due = await takeDueAlarms(this.ctx.storage, Date.now())
    await this.#refreshRecovery(await this.#harness)
    for (const purpose of due) await this.#onAlarm(purpose)
  }

  /**
   * Durably admit input. The recovery alarm is persisted first, which also covers the window
   * between admission and Pi's scheduler.
   */
  async #admit(draft: SubmissionDraft): Promise<Submission> {
    const harness = await this.#harness
    const conversation = await harness.root(context)
    const submission = await this.#serial(async () => {
      await armRecovery(this.ctx.storage)
      return conversation.submit(draft, context)
    })
    await this.#refreshRecovery(harness)
    return submission
  }

  async sendMessage(request: SendMessageRequest): Promise<number> {
    this.#workingOnly('take chat input')
    const message = parseMessage(request)
    await refuseWhenFull(this.ctx.storage)
    const config = await readConfig(await this.#config())
    if (!(await createAgentModels(this.env).checkAuth(config.model.provider))) {
      throw new Error(`Credentials are not configured for provider: ${config.model.provider}`)
    }
    if (await isIdle(await this.#harness)) {
      await refreshMemory(this.#workingMemory(), { onlyIfChanged: true })
    }
    const submission = await this.#admit({
      type: 'input',
      requestId: message.requestId,
      content: message.content,
      whenBusy: message.whenBusy ?? 'followUp',
    })
    return submission.id
  }

  async send(request: SendMessageRequest): Promise<ReadableStream<Uint8Array>> {
    const message = parseMessage(request)
    return sendEvents(await this.#harness, message.requestId, () => this.sendMessage(message))
  }

  async getConfig(): Promise<AgentConfig> {
    return readConfig(await this.#config())
  }

  async subscribe(): Promise<ReadableStream<Uint8Array>> {
    return subscribeEvents(await this.#harness)
  }

  /** Replace configuration while idle; history and request receipts are retained. */
  async setConfig(value: AgentConfig): Promise<AgentConfig> {
    this.#workingOnly('change its configuration')
    const store = await this.#config()
    return this.#serial(async () => {
      const config = await replaceConfig(store, createAgentModels(this.env), value)
      // The spaces decide what the always-loaded memory and the skills list hold.
      await refreshMemory(this.#workingMemory())
      return config
    })
  }

  /**
   * Stop the current run, including a retry wait, and withdraw queued input. Affected submissions settle
   * as unanswered; history and configuration are kept. Resolves once the agent is idle.
   */
  async cancel(): Promise<void> {
    const harness = await this.#harness
    const conversation = await harness.root(context)
    await conversation.abort(context)
    await this.#refreshRecovery(harness)
  }

  /** Deliver to another agent through DO RPC; acceptance does not wait for its model response. */
  async sendTo(agentId: string, request: SendMessageRequest): Promise<SendMessageResponse> {
    this.#workingOnly('message other agents')
    parseAgentId(agentId)
    const message = parseMessage(request)
    const submissionId = await this.env.AGENTS.getByName(agentId).sendMessage(message)
    return { agentId, requestId: message.requestId, submissionId }
  }

  async snapshot(): Promise<AgentSnapshot> {
    return snapshotOf(await this.#harness)
  }

  async submission(requestId: string): Promise<SubmissionStatus | undefined> {
    parseRequestId(requestId)
    return submissionOf(await this.#harness, requestId)
  }

  /** Conversation text after entry `after`, oldest first, for the memory agent. */
  readEntries(request: { after: number; limit: number }): Promise<EntryPage> {
    return readEntries(
      {
        agentId: this.#agentId(),
        harness: () => this.#harness,
        local: () => this.#local,
        db: memoryDb(this.env.MEMORY_DB),
        archive: this.env.ARCHIVE,
      },
      request,
    )
  }

  /** The memory agent changed this agent's memory; the copy is refreshed while idle. */
  async memoryChanged(): Promise<void> {
    if (await isIdle(await this.#harness)) await refreshMemory(this.#workingMemory())
    else this.#memoryChanged = true
  }

  /**
   * Archive and delete old entries until the database is under the threshold, or one run with
   * `force`. A run whose delete checks fail is retried by the prune alarm.
   */
  prune(request: { force?: boolean } = {}): Promise<PruneOutcome> {
    this.#pruning ??= pruneUntilUnder(this.#pruneDeps(), request.force === true).finally(() => {
      this.#pruning = undefined
    })
    return this.#pruning
  }

  /** Queue a memory job on the memory agent; the same job delivered again returns its status. */
  async enqueue(job: unknown): Promise<JobStatus> {
    this.#memoryAgentOnly()
    const status = await enqueueJob(this.#memoryAgentContext(), job)
    this.#jobs.start()
    return status
  }

  async jobStatus(jobId: string): Promise<JobStatus | undefined> {
    this.#memoryAgentOnly()
    return jobStatus(await this.#local, jobId)
  }

  /** The memory agent's daily consolidation, called by the scheduled handler. */
  async consolidate(now: number): Promise<{ scopes: number }> {
    this.#memoryAgentOnly()
    return consolidate(this.#memoryAgentContext(), now, (job) => this.enqueue(job))
  }
}
