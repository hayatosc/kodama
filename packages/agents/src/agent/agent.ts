import { DurableObject } from 'cloudflare:workers'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type {
  Harness,
  HarnessOptions,
  Submission,
  SubmissionDraft,
} from '@earendil-works/pi-durable'
import { AlarmSchedule } from './alarms.ts'
import type { AlarmPurpose } from './alarms.ts'
import {
  defaultAgentConfig,
  initializeAgentConfig,
  readSharedSpaces,
} from '../configuration/index.ts'
import type { AgentEnv } from '../env.ts'
import { sendEvents, subscribeEvents } from './events.ts'
import { createAgentOptions } from './harness.ts'
import { memoryDb } from '../memory/store/db.ts'
import type { PruneDeps, PruneOutcome } from '../memory/prune/prune.ts'
import { MEMORY_AGENT_NAME } from '../memory/jobs.ts'
import type { JobStatus } from '../memory/jobs.ts'
import { MemoryAgentRole } from '../memory/memory-agent/memory-agent.ts'
import type { WorkingMemoryDeps } from '../memory/working/deps.ts'
import { createAgentModels } from '../models/index.ts'
import type {
  AgentConfig,
  AgentSnapshot,
  SendMessageRequest,
  SendMessageResponse,
  SubmissionStatus,
} from '../protocol.ts'
import { RecoveryAlarm } from './recovery.ts'
import { openLocalDb } from '../storage/local.ts'
import type { LocalDb } from '../storage/local.ts'
import { parseAgentId, parseMessage, parseRequestId } from '../validation.ts'
import { readEntries } from './entries.ts'
import type { EntryPage } from './entries.ts'
import { readConfig, replaceConfig } from './config.ts'
import type { ConfigStore } from './config.ts'
import { StorageMaintenance } from './maintenance.ts'
import { AgentMemory, EXTRACT_IDLE_DELAY_MS } from './memory.ts'
import { AgentSession, isIdle } from './session.ts'
import { snapshotOf, submissionOf } from './views.ts'

const context = BACKGROUND_CONTEXT

/**
 * One named object owns one agent and its durable Pi session. This class only wires the parts in
 * this folder together and serves RPC; behavior lives in those parts.
 *
 * The memory agent is one of these objects too, under the reserved name `MEMORY_AGENT_NAME`. It
 * takes the memory agent role: its own harness and configuration, and a job queue instead of chat
 * input. The name is not a valid public agent ID, so `AgentService` cannot reach it.
 */
export class Agent extends DurableObject<AgentEnv> {
  readonly #alarms: AlarmSchedule
  readonly #memoryAgent: MemoryAgentRole | undefined
  readonly #recovery: RecoveryAlarm
  readonly #local: Promise<LocalDb>
  readonly #memory: AgentMemory
  readonly #maintenance: StorageMaintenance
  readonly #session: AgentSession

  constructor(ctx: DurableObjectState, env: AgentEnv) {
    super(ctx, env)
    this.#alarms = new AlarmSchedule(ctx.storage)
    this.#recovery = new RecoveryAlarm(this.#alarms, () => this.#onIdle())
    this.#local = openLocalDb(ctx.storage)
    this.#memoryAgent =
      ctx.id.name === MEMORY_AGENT_NAME
        ? new MemoryAgentRole({
            env,
            storage: ctx.storage,
            alarms: this.#alarms,
            harness: () => this.#session.harness(),
            local: () => this.#local,
            admit: (draft) => this.#admit(draft),
            prune: () => this.prune(),
          })
        : undefined
    this.#memory = new AgentMemory(this.#workingMemoryDeps())
    this.#maintenance = new StorageMaintenance({
      storage: ctx.storage,
      alarms: this.#alarms,
      local: () => this.#local,
      pruneDeps: () => this.#pruneDeps(),
    })
    this.#session = new AgentSession(
      ctx,
      {
        options: () => this.#harnessOptions(),
        prepare: async (harness) => {
          await harness.root(context)
          await initializeAgentConfig(harness, this.#defaultConfig())
          await this.#afterOpen(harness)
          await this.#recovery.refresh(harness)
        },
      },
      this.#local,
    )
  }

  /** This agent's ID, the name its object was created with. */
  #agentId(): string {
    const name = this.ctx.id.name
    if (name === undefined) throw new Error('Agents are addressed by name')
    return name
  }

  /** The memory agent role, or an error for a working agent. */
  #jobs(): MemoryAgentRole {
    if (this.#memoryAgent === undefined) throw new Error('Only the memory agent takes jobs')
    return this.#memoryAgent
  }

  /** Reject chat input and configuration on the memory agent, whose input is its job queue. */
  #workingOnly(action: string): void {
    if (this.#memoryAgent !== undefined) {
      throw new Error(`The memory agent does not ${action}; it takes jobs through enqueue`)
    }
  }

  #workingMemoryDeps(): WorkingMemoryDeps {
    return {
      env: this.env,
      agentId: () => this.#agentId(),
      local: () => this.#local,
      sharedSpaces: () => this.#sharedSpaces(),
    }
  }

  /** Called on every open, so a changed registry or setting applies after eviction. */
  #harnessOptions(): HarnessOptions {
    return (
      this.#memoryAgent?.harnessOptions() ??
      createAgentOptions(this.env, [this.#memory.extension()])
    )
  }

  #defaultConfig(): AgentConfig {
    return this.#memoryAgent?.defaultConfig() ?? defaultAgentConfig(this.env)
  }

  async #config(): Promise<ConfigStore> {
    return {
      harness: await this.#session.harness(),
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
      harness: () => this.#session.harness(),
      exclusive: (check, mutate) => this.#session.exclusive(check, mutate),
      // The memory agent's history is job scratch work: pruning deletes it without an archive.
      archive: this.#memoryAgent === undefined,
      memoryAgent: () => this.env.AGENTS.getByName(MEMORY_AGENT_NAME),
    }
  }

  /** Runs once the harness is open, before the object serves requests. */
  async #afterOpen(harness: Harness): Promise<void> {
    // The memory agent keeps no memory of its own and extracts nothing.
    if (this.#memoryAgent !== undefined) return this.#memoryAgent.afterOpen(harness)
    await this.#memory.refresh()
  }

  /** Runs whenever Pi has no runnable task left. The memory agent prunes between its jobs. */
  async #onIdle(): Promise<void> {
    if (this.#memoryAgent !== undefined) return
    await this.#alarms.set('extract', Date.now() + EXTRACT_IDLE_DELAY_MS)
    await this.#maintenance.scheduleIfNeeded()
    await this.#memory.onIdle()
  }

  async #onAlarm(purpose: AlarmPurpose): Promise<void> {
    if (this.#memoryAgent !== undefined) return this.#memoryAgent.onAlarm(purpose)
    if (purpose === 'extract') {
      const harness = await this.#session.harness()
      if (await isIdle(harness)) await this.#memory.extract(harness)
    }
    if (purpose === 'prune') await this.prune()
  }

  override async alarm(): Promise<void> {
    // Take due purposes first: the recovery refresh reschedules extraction when it finds the agent idle.
    const due = await this.#alarms.take(Date.now())
    await this.#recovery.refresh(await this.#session.harness())
    for (const purpose of due) await this.#onAlarm(purpose)
  }

  /**
   * Durably admit input. The recovery alarm is persisted first, which also covers the window
   * between admission and Pi's scheduler.
   */
  async #admit(draft: SubmissionDraft): Promise<Submission> {
    const harness = await this.#session.harness()
    const conversation = await harness.root(context)
    const submission = await this.#recovery.serialize(async () => {
      await this.#recovery.arm()
      return conversation.submit(draft, context)
    })
    await this.#recovery.refresh(harness)
    return submission
  }

  async sendMessage(request: SendMessageRequest): Promise<number> {
    this.#workingOnly('take chat input')
    const message = parseMessage(request)
    await this.#maintenance.refuseWhenFull()
    const config = await readConfig(await this.#config())
    if (!(await createAgentModels(this.env).checkAuth(config.model.provider))) {
      throw new Error(`Credentials are not configured for provider: ${config.model.provider}`)
    }
    if (await isIdle(await this.#session.harness())) await this.#memory.refreshIfChanged()
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
    return sendEvents(await this.#session.harness(), message.requestId, () =>
      this.sendMessage(message),
    )
  }

  async getConfig(): Promise<AgentConfig> {
    return readConfig(await this.#config())
  }

  async subscribe(): Promise<ReadableStream<Uint8Array>> {
    return subscribeEvents(await this.#session.harness())
  }

  /** Replace configuration while idle; history and request receipts are retained. */
  async setConfig(value: AgentConfig): Promise<AgentConfig> {
    this.#workingOnly('change its configuration')
    const store = await this.#config()
    return this.#recovery.serialize(async () => {
      const config = await replaceConfig(store, createAgentModels(this.env), value)
      // The spaces decide what the always-loaded memory and the skills list hold.
      await this.#memory.refresh()
      return config
    })
  }

  /**
   * Stop the current run, including a retry wait, and withdraw queued input. Affected submissions settle
   * as unanswered; history and configuration are kept. Resolves once the agent is idle.
   */
  async cancel(): Promise<void> {
    const harness = await this.#session.harness()
    const conversation = await harness.root(context)
    await conversation.abort(context)
    await this.#recovery.refresh(harness)
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
    return snapshotOf(await this.#session.harness())
  }

  async submission(requestId: string): Promise<SubmissionStatus | undefined> {
    parseRequestId(requestId)
    return submissionOf(await this.#session.harness(), requestId)
  }

  /** Conversation text after entry `after`, oldest first, for the memory agent. */
  readEntries(request: { after: number; limit: number }): Promise<EntryPage> {
    return readEntries(
      {
        agentId: this.#agentId(),
        harness: () => this.#session.harness(),
        local: () => this.#local,
        db: memoryDb(this.env.MEMORY_DB),
        archive: this.env.ARCHIVE,
      },
      request,
    )
  }

  /** The memory agent changed this agent's memory; the copy is refreshed while idle. */
  async memoryChanged(): Promise<void> {
    await this.#memory.changed(await isIdle(await this.#session.harness()))
  }

  /**
   * Archive and delete old entries until the database is under the threshold, or one run with
   * `force`. A run whose delete checks fail is retried by the prune alarm.
   */
  prune(request: { force?: boolean } = {}): Promise<PruneOutcome> {
    return this.#maintenance.prune(request)
  }

  /** Queue a memory job on the memory agent; the same job delivered again returns its status. */
  enqueue(job: unknown): Promise<JobStatus> {
    return this.#jobs().enqueue(job)
  }

  jobStatus(jobId: string): Promise<JobStatus | undefined> {
    return this.#jobs().jobStatus(jobId)
  }

  /** The memory agent's daily consolidation, called by the scheduled handler. */
  consolidate(now: number): Promise<{ scopes: number }> {
    return this.#jobs().consolidate(now)
  }
}
