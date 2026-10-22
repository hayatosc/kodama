/**
 * The `Agent` Durable Object: a working agent, and the base class of the memory agent.
 *
 * @see docs/agents.md — The Agent Durable Object
 *
 * @module
 */
import { DurableObject } from 'cloudflare:workers'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type {
  Harness,
  HarnessOptions,
  Submission,
  SubmissionDraft,
  TaskId,
} from '@earendil-works/pi-durable'
import {
  setAlarm,
  setAlarmNoLaterThan,
  takeDueAlarms,
  armRecovery,
  refreshRecovery,
} from './alarms.ts'
import type { AlarmPurpose } from './alarms.ts'
import {
  defaultAgentConfig,
  initializeAgentConfig,
  readSharedSpaces,
  readConfig,
  replaceConfig,
} from '../configuration/index.ts'
import type { AgentEnv } from '../env.ts'
import { serialQueue } from '../lib/serial.ts'
import { sendEvents, subscribeEvents } from './events.ts'
import { createAgentOptions, exclusiveSection, isIdle, openHarness } from './harness.ts'
import { memoryDb } from '../memory/store/db.ts'
import type { PruneDeps, PruneOutcome } from '../memory/prune/prune.ts'
import { MEMORY_AGENT_NAME } from '../memory/jobs.ts'
import type { JobStatus } from '../memory/jobs.ts'
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
import { openLocalDb } from '../storage/local.ts'
import type { LocalDb } from '../storage/local.ts'
import { parseAgentId, parseMessage, parseRequestId } from '../validation.ts'
import { readEntries } from '../memory/transcript.ts'
import type { EntryPage } from '../memory/transcript.ts'
import type { ConfigStore } from '../configuration/index.ts'
import {
  pruneUntilUnder,
  refuseWhenFull,
  schedulePruneIfNeeded,
  EXTRACT_IDLE_DELAY_MS,
  extractNewEntries,
  refreshMemory,
} from './memory.ts'
import { snapshotOf, submissionOf } from './views.ts'

const context = BACKGROUND_CONTEXT

/**
 * One named object owns one working agent and its durable Pi session.
 *
 * @remarks
 * The class serves RPC and holds the object's in-memory state in private fields; the work is done
 * by plain functions in `src/agent/` and `src/memory/`.
 *
 * Dedicated agents such as `MemoryAgent` (`dedicated/memory/agent.ts`) extend it, live in the same
 * `AGENTS` namespace under reserved names (see `dedicated/index.ts`), and override the protected
 * hooks: {@link Agent.harnessOptions}, {@link Agent.defaultConfig}, {@link Agent.prepare},
 * {@link Agent.onIdle}, {@link Agent.onAlarm}, and {@link Agent.archivesPrunedEntries}. A method
 * only a dedicated agent serves, such as {@link Agent.enqueue}, is declared here and rejects, so
 * one stub type covers every object in the namespace. TypeScript's `protected` does not exist at
 * runtime, so code holding the binding could call the hooks over RPC; only this Worker holds it.
 */
export class Agent extends DurableObject<AgentEnv> {
  /** Kodama's own tables in this object's SQLite, opened before the harness. */
  readonly #local: Promise<LocalDb>
  /** The open harness; replaced when pruning closes and reopens it. */
  #harness: Promise<Harness>
  /** Alarm updates and admissions that depend on them run one at a time. */
  readonly #serial = serialQueue()
  /** Tasks the recovery alarm already watches. */
  readonly #watching = new Set<TaskId>()
  /** The pruning pass in progress; concurrent calls share it. */
  #pruning: Promise<PruneOutcome> | undefined
  /** A memory change arrived while the agent was busy; refresh at the next idle moment. */
  #memoryChanged = false

  /** Open the local tables and the harness; every request waits until both are ready. */
  constructor(ctx: DurableObjectState, env: AgentEnv) {
    super(ctx, env)
    this.#local = openLocalDb(ctx.storage)
    // Every request waits until the harness is open and prepared. The await comes first, so a
    // subclass has initialized its fields before `#open` calls its hooks.
    this.#harness = ctx.blockConcurrencyWhile(async () => {
      await this.#local
      return this.#open()
    })
  }

  /**
   * Open and prepare the harness: the root conversation, the configuration, {@link Agent.prepare},
   * and the recovery alarm.
   */
  #open(): Promise<Harness> {
    return openHarness(this.ctx, this.harnessOptions(), async (harness) => {
      await harness.root(context)
      await initializeAgentConfig(harness, this.defaultConfig())
      await this.prepare(harness)
      await this.#refreshRecovery(harness)
    })
  }

  /** The open harness; it changes when pruning closes and reopens it. */
  protected harness(): Promise<Harness> {
    return this.#harness
  }

  /** Kodama's own tables in this object's SQLite. */
  protected local(): Promise<LocalDb> {
    return this.#local
  }

  /**
   * Runtime options of the harness, read on every open so a changed registry or setting applies
   * after eviction. A working agent gets its tools and the long-term memory extension.
   */
  protected harnessOptions(): HarnessOptions {
    return createAgentOptions(this.env, [createWorkingMemoryExtension(this.#workingMemory())])
  }

  /** The configuration a new agent starts with. */
  protected defaultConfig(): AgentConfig {
    return defaultAgentConfig(this.env)
  }

  /** The last step of opening, before recovery: a working agent refreshes its memory copy. */
  protected async prepare(_harness: Harness): Promise<void> {
    await refreshMemory(this.#workingMemory())
  }

  /**
   * Runs whenever Pi has no runnable task left: schedule extraction and pruning, and apply a memory
   * change that arrived while busy.
   */
  protected async onIdle(): Promise<void> {
    // Reopening an idle object must not postpone the deadline that woke it.
    await setAlarmNoLaterThan(this.ctx.storage, 'extract', Date.now() + EXTRACT_IDLE_DELAY_MS)
    await schedulePruneIfNeeded(this.ctx.storage, await this.#local)
    if (!this.#memoryChanged) return
    this.#memoryChanged = false
    await refreshMemory(this.#workingMemory())
  }

  /** Handle one due alarm purpose: extraction once idle, and pruning. */
  protected async onAlarm(purpose: AlarmPurpose): Promise<void> {
    if (purpose === 'extract') {
      const harness = await this.#harness
      if (await isIdle(harness)) await extractNewEntries(this.#workingMemory(), harness)
    }
    if (purpose === 'prune') await this.prune()
  }

  /** Whether pruning archives entries to R2 before deleting them. */
  protected archivesPrunedEntries(): boolean {
    return true
  }

  /** This agent's ID, the name its object was created with. */
  #agentId(): string {
    const name = this.ctx.id.name
    if (name === undefined) throw new Error('Agents are addressed by name')
    return name
  }

  /** What the working agent's memory functions need from this object. */
  #workingMemory(): WorkingMemoryDeps {
    return {
      env: this.env,
      agentId: () => this.#agentId(),
      local: () => this.#local,
      sharedSpaces: () => this.#sharedSpaces(),
    }
  }

  /** The stored configuration's location and defaults. */
  async #config(): Promise<ConfigStore> {
    return {
      harness: await this.#harness,
      storage: this.ctx.storage,
      defaults: this.defaultConfig(),
    }
  }

  /** The shared spaces this agent reads, earliest first. */
  #sharedSpaces(): Promise<string[]> {
    return readSharedSpaces(this.ctx.storage, this.defaultConfig().sharedSpaces)
  }

  /** What pruning needs from this object. */
  #pruneDeps(): PruneDeps {
    return {
      storage: this.ctx.storage,
      env: this.env,
      agentId: () => this.#agentId(),
      local: () => this.#local,
      harness: () => this.#harness,
      exclusive: (check, mutate) => this.#exclusive(check, mutate),
      archive: this.archivesPrunedEntries(),
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
        onIdle: () => this.onIdle(),
        refreshAgain: () => this.#refreshRecovery(harness),
      }),
    )
  }

  /**
   * The platform alarm: take the due purposes, refresh recovery, and handle each purpose.
   *
   * @remarks
   * Due purposes are taken first, because the recovery refresh reschedules extraction when it finds
   * the agent idle.
   */
  override async alarm(): Promise<void> {
    const due = await takeDueAlarms(this.ctx.storage, Date.now())
    await this.#refreshRecovery(await this.#harness)
    for (const purpose of due) await this.onAlarm(purpose)
  }

  /**
   * Durably admit input to the root conversation.
   *
   * @remarks
   * The recovery alarm is persisted first, in the serial queue, which also covers the window between
   * admission and Pi's scheduler.
   */
  protected async admit(draft: SubmissionDraft): Promise<Submission> {
    const harness = await this.#harness
    const conversation = await harness.root(context)
    const submission = await this.#serial(async () => {
      await armRecovery(this.ctx.storage)
      // New activity ends the previous idle period; its completion starts a fresh delay.
      await setAlarm(this.ctx.storage, 'extract', undefined)
      return conversation.submit(draft, context)
    })
    await this.#refreshRecovery(harness)
    return submission
  }

  /**
   * Durably admit a message from a user or another agent, without waiting for the answer.
   *
   * @returns The submission ID.
   * @throws {@link TypeError} When the message is invalid.
   * @throws When the database is above the hard storage limit, or the selected provider has no
   * credentials.
   */
  async sendMessage(request: SendMessageRequest): Promise<number> {
    const message = parseMessage(request)
    await refuseWhenFull(this.ctx.storage)
    const config = await readConfig(await this.#config())
    if (!(await createAgentModels(this.env).checkAuth(config.model.provider))) {
      throw new Error(`Credentials are not configured for provider: ${config.model.provider}`)
    }
    if (await isIdle(await this.#harness)) {
      await refreshMemory(this.#workingMemory(), { onlyIfChanged: true })
    }
    const submission = await this.admit({
      type: 'input',
      requestId: message.requestId,
      content: message.content,
      whenBusy: message.whenBusy ?? 'followUp',
    })
    return submission.id
  }

  /**
   * Admit a message and stream its run as SSE until its submission settles.
   *
   * @throws {@link TypeError} When the message is invalid; nothing is admitted.
   */
  async send(request: SendMessageRequest): Promise<ReadableStream<Uint8Array>> {
    const message = parseMessage(request)
    return sendEvents(await this.#harness, message.requestId, () => this.sendMessage(message))
  }

  /** The stored configuration. */
  async getConfig(): Promise<AgentConfig> {
    return readConfig(await this.#config())
  }

  /** An SSE stream of this agent's events, starting with a snapshot. */
  async subscribe(): Promise<ReadableStream<Uint8Array>> {
    return subscribeEvents(await this.#harness)
  }

  /**
   * Replace the configuration while idle; history and request receipts are kept.
   *
   * @throws {@link TypeError} When the configuration is invalid.
   * @throws When work is pending.
   */
  async setConfig(value: AgentConfig): Promise<AgentConfig> {
    const store = await this.#config()
    return this.#serial(async () => {
      const config = await replaceConfig(store, createAgentModels(this.env), value)
      // The spaces decide what the always-loaded memory and the skills list hold.
      await refreshMemory(this.#workingMemory())
      return config
    })
  }

  /**
   * Stop the current run, including a retry wait, and withdraw queued input.
   *
   * @remarks
   * Affected submissions settle as `unanswered`; history and configuration are kept. Resolves once
   * the agent is idle.
   */
  async cancel(): Promise<void> {
    const harness = await this.#harness
    const conversation = await harness.root(context)
    await conversation.abort(context)
    await this.#refreshRecovery(harness)
  }

  /**
   * Deliver a message to another agent; acceptance does not wait for its model response.
   *
   * @throws {@link TypeError} When the target ID or the message is invalid.
   */
  async sendTo(agentId: string, request: SendMessageRequest): Promise<SendMessageResponse> {
    parseAgentId(agentId)
    const message = parseMessage(request)
    const submissionId = await this.env.AGENTS.getByName(agentId).sendMessage(message)
    return { agentId, requestId: message.requestId, submissionId }
  }

  /** Committed user and assistant messages, and whether the agent is busy. */
  async snapshot(): Promise<AgentSnapshot> {
    return snapshotOf(await this.#harness)
  }

  /**
   * The status of the submission with this request ID, if there is one.
   *
   * @throws {@link TypeError} When `requestId` is invalid.
   */
  async submission(requestId: string): Promise<SubmissionStatus | undefined> {
    parseRequestId(requestId)
    return submissionOf(await this.#harness, requestId)
  }

  /**
   * Conversation text after entry `after`, oldest first, for the memory agent's extraction.
   *
   * @remarks
   * Entries already pruned are read from their archived segment in R2.
   */
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

  /**
   * The memory agent changed this agent's memory: refresh the copy now if idle, else when next idle.
   */
  async memoryChanged(): Promise<void> {
    if (await isIdle(await this.#harness)) await refreshMemory(this.#workingMemory())
    else this.#memoryChanged = true
  }

  /**
   * Archive and delete old entries until the database is under the threshold, or run once with
   * `force`. Concurrent calls share the running pass.
   */
  prune(request: { force?: boolean } = {}): Promise<PruneOutcome> {
    this.#pruning ??= pruneUntilUnder(this.#pruneDeps(), request.force === true).finally(() => {
      this.#pruning = undefined
    })
    return this.#pruning
  }

  /**
   * Queue a memory job. Only the memory agent takes jobs.
   *
   * @throws Always, unless overridden by `MemoryAgent`.
   */
  enqueue(_job: unknown): Promise<JobStatus> {
    return Promise.reject(new Error('Only the memory agent takes jobs'))
  }

  /**
   * A memory job's status. Only the memory agent has jobs.
   *
   * @throws Always, unless overridden by `MemoryAgent`.
   */
  jobStatus(_jobId: string): Promise<JobStatus | undefined> {
    return Promise.reject(new Error('Only the memory agent takes jobs'))
  }

  /**
   * The daily consolidation. Only the memory agent consolidates.
   *
   * @throws Always, unless overridden by `MemoryAgent`.
   */
  consolidate(_now: number): Promise<{ scopes: number }> {
    return Promise.reject(new Error('Only the memory agent takes jobs'))
  }
}
