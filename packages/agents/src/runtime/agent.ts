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
  AgentChange,
  Harness,
  HarnessOptions,
  Submission,
  SubmissionDraft,
  TaskId,
} from '@earendil-works/pi-durable'
import * as v from 'valibot'
import {
  setAlarm,
  setAlarmNoLaterThan,
  takeDueAlarms,
  armRecovery,
  refreshRecovery,
} from './alarms.ts'
import type { AlarmPurpose } from './alarms.ts'
import {
  agentChange,
  defaultAgentConfig,
  initializeAgentConfig,
  parseSettings,
  readSharedSpaces,
  readConfig,
} from '../configuration/index.ts'
import { managementDb } from '../management/db.ts'
import { AGENT_STATUSES } from '../../drizzle/management/schema.ts'
import { admitAgent } from '../management/registry.ts'
import { reportApplied } from '../management/versions.ts'
import { applyOrHold, applyPending, appliedSettings, pullIfBehind } from './config-apply.ts'
import type { ApplyDeps, PushedConfig } from './config-apply.ts'
import {
  anyRefusal,
  assertAllowed,
  STATUS_KEY,
  statusRefusal,
  toolGuardExtension,
} from './restrictions.ts'
import type { Refusal } from './restrictions.ts'
import { refreshAlwaysLoaded } from '../memory/working/always-loaded.ts'
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
  AgentSettings,
  AgentSnapshot,
  AgentStatus,
  ApplyResult,
  SendMessageRequest,
  SendMessageResponse,
  SubmissionStatus,
} from '../protocol.ts'
import { openLocalDb } from '../storage/local.ts'
import type { LocalDb } from '../storage/local.ts'
import { parseAgentId, parseInput, parseMessage, parseRequestId } from '../validation.ts'
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
 * by plain functions in `src/runtime/` and `src/memory/`.
 *
 * System agents such as `MemoryAgent` (`src/system-agents/memory/agent.ts`) extend it, live in the
 * same `AGENTS` namespace under reserved names (see `src/agent-object.ts`), and override the protected
 * hooks: {@link Agent.harnessOptions}, {@link Agent.defaultConfig}, {@link Agent.prepare},
 * {@link Agent.onIdle}, {@link Agent.onAlarm}, {@link Agent.archivesPrunedEntries},
 * {@link Agent.configChange}, and {@link Agent.rebuildMemory}. A method
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
  /** Why the next external call must not happen, checked before each one. */
  readonly #refusal: Refusal

  /** Open the local tables and the harness; every request waits until both are ready. */
  constructor(ctx: DurableObjectState, env: AgentEnv) {
    super(ctx, env)
    this.#refusal = anyRefusal(statusRefusal(ctx.storage))
    this.#local = openLocalDb(ctx.storage)
    // Every request waits until the harness is open and prepared. The await comes first, so a
    // subclass has initialized its fields before `#open` calls its hooks.
    this.#harness = ctx.blockConcurrencyWhile(async () => {
      await this.#local
      return this.#open()
    })
  }

  /**
   * Open and prepare the harness: the root conversation, the configuration and the registry's
   * desired version, {@link Agent.prepare}, and the recovery alarm.
   */
  #open(): Promise<Harness> {
    return openHarness(this.ctx, this.harnessOptions(), async (harness) => {
      await harness.root(context)
      await initializeAgentConfig(harness, this.defaultConfig())
      await this.#catchUp(harness)
      await this.prepare(harness)
      await this.#refreshRecovery(harness)
    })
  }

  /**
   * Apply or hold the registry's desired version if it is newer than the applied one. Opening
   * holds every other request, so this runs outside the serial queue. A failure is logged, and
   * reconciliation retries.
   */
  async #catchUp(harness: Harness): Promise<void> {
    try {
      await pullIfBehind(this.#applyDeps(harness), {
        db: managementDb(this.env.MANAGEMENT_DB),
        objectName: this.#agentId(),
        parse: (value) => parseSettings(createAgentModels(this.env), value),
      })
    } catch (error) {
      console.error('Catching up with the registry failed', error)
    }
  }

  /** Why the next external call must not happen; checked before each one. */
  protected refusal(): Refusal {
    return this.#refusal
  }

  /** How a version's settings become Pi's change; the memory agent has its own. */
  protected configChange(settings: AgentSettings): AgentChange {
    return agentChange(settings)
  }

  /**
   * Rebuild the always-loaded memory for a version's shared spaces; a failure fails the apply, so
   * the version stays pending.
   */
  protected async rebuildMemory(settings: AgentSettings): Promise<void> {
    await refreshAlwaysLoaded({
      ...this.#workingMemory(),
      sharedSpaces: async () => [...settings.sharedSpaces],
    })
  }

  /** What applying a version needs from this object. */
  #applyDeps(harness: Harness): ApplyDeps {
    return {
      storage: this.ctx.storage,
      harness,
      change: (settings) => this.configChange(settings),
      rebuildMemory: (settings) => this.rebuildMemory(settings),
      report: async (agentId, version) => {
        await reportApplied(managementDb(this.env.MANAGEMENT_DB), agentId, version)
      },
    }
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
    return createAgentOptions(
      this.env,
      [
        createWorkingMemoryExtension(this.#workingMemory()),
        toolGuardExtension(this.#refusal, () => appliedSettings(this.ctx.storage)),
      ],
      this.#refusal,
    )
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
    const extracts = (await appliedSettings(this.ctx.storage))?.memoryPolicy.extract !== false
    // Only actual activity starts an idle extraction period; reopening preserves its deadline.
    if (extracts && (await this.ctx.storage.get<boolean>('kodama:extract-pending'))) {
      await setAlarmNoLaterThan(this.ctx.storage, 'extract', Date.now() + EXTRACT_IDLE_DELAY_MS)
    }
    await schedulePruneIfNeeded(this.ctx.storage, await this.#local)
    if (!this.#memoryChanged) return
    this.#memoryChanged = false
    await refreshMemory(this.#workingMemory())
  }

  /** Handle one due alarm purpose: extraction once idle, and pruning. */
  protected async onAlarm(purpose: AlarmPurpose): Promise<void> {
    if (purpose === 'extract') {
      const harness = await this.#harness
      await this.#serial(async () => {
        // The applied version decides at run time: one that disabled extraction after this alarm
        // was set wins, and the alarm is dropped. The pending activity stays for re-enabling.
        if ((await appliedSettings(this.ctx.storage))?.memoryPolicy.extract === false) {
          await setAlarm(this.ctx.storage, 'extract', undefined)
          return
        }
        if (!(await isIdle(harness))) return
        await extractNewEntries(this.#workingMemory(), harness)
        await this.ctx.storage.delete('kodama:extract-pending')
        await setAlarm(this.ctx.storage, 'extract', undefined)
      })
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
        // A held version first, outside the overridable hook, which the memory agent replaces.
        onIdle: async () => {
          await applyPending(this.#applyDeps(harness))
          await this.onIdle()
        },
        refreshAgain: () => this.#refreshRecovery(harness),
      }),
    )
  }

  /**
   * The platform alarm: take the due purposes, refresh recovery, and handle each purpose.
   *
   * @remarks
   * Due purposes are taken first. Successful extraction clears its pending activity and deadline,
   * including any deadline restored by the recovery refresh.
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
      await this.ctx.storage.put('kodama:extract-pending', true)
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
   * Apply a configuration version pushed from the registry: now when idle, otherwise at the next
   * idle moment. Idempotent by version number.
   *
   * @throws {@link TypeError} When the settings are invalid.
   */
  async applyConfig(pushed: PushedConfig): Promise<ApplyResult> {
    const settings = parseSettings(createAgentModels(this.env), pushed.settings)
    const agentId = parseAgentId(pushed.agentId)
    const harness = await this.#harness
    const deps = this.#applyDeps(harness)
    return this.#serial(() => applyOrHold(deps, { agentId, version: pushed.version, settings }))
  }

  /**
   * Set this object's copy of its registry state. It takes effect at the next external call, even
   * in the middle of a turn.
   *
   * @throws {@link TypeError} When `status` is not a lifecycle state.
   */
  async setStatus(status: AgentStatus): Promise<void> {
    this.ctx.storage.kv.put(STATUS_KEY, parseInput(v.picklist(AGENT_STATUSES), status))
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
   * @throws {@link TypeError} When the target ID or the message is invalid, or the registry has no
   * working agent with that ID.
   * @throws {@link Error} When this agent's state stops external calls, or the target's state does
   * not admit messages.
   */
  async sendTo(agentId: string, request: SendMessageRequest): Promise<SendMessageResponse> {
    parseAgentId(agentId)
    const message = parseMessage(request)
    assertAllowed(this.#refusal)
    const objectName = await admitAgent(managementDb(this.env.MANAGEMENT_DB), agentId, 'chat')
    const submissionId = await this.env.AGENTS.getByName(objectName).sendMessage(message)
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
