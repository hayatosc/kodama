import { DurableObject } from 'cloudflare:workers'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { configure, Harness, ROOT_CONVERSATION_ID, watchEvents } from '@earendil-works/pi-durable'
import type {
  EntryId,
  HarnessOptions,
  Submission,
  SubmissionDraft,
} from '@earendil-works/pi-durable'
import { openDurableObjectSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/cloudflare'
import { AlarmSchedule } from './alarms.ts'
import type { AlarmPurpose } from './alarms.ts'
import { createAgentOptions } from './harness.ts'
import { sendEvents, subscribeEvents } from './events.ts'
import {
  agentChange,
  agentConfigSchema,
  defaultAgentConfig,
  initializeAgentConfig,
  readAgentConfig,
  sharedSpacesSchema,
} from './configuration/index.ts'
import { createAgentModels } from './models/index.ts'
import { toAgentSnapshot, toSubmissionStatus } from './projection.ts'
import { RecoveryAlarm } from './recovery.ts'
import { and, asc, eq, gt } from 'drizzle-orm'
import * as v from 'valibot'
import { readArchivedText } from './memory/archive.ts'
import {
  needsPrune,
  pruneLimits,
  pruneOnce,
  prunedThrough,
  PRUNE_RETRY_MS,
} from './memory/prune.ts'
import type { PruneDeps, PruneOutcome } from './memory/prune.ts'
import { extractionCheckpoint, memoryDb } from './memory/records.ts'
import { archiveSegments } from './memory/schema.ts'
import { SkillsEnv } from './memory/skills-env.ts'
import { entryText } from './memory/transcript.ts'
import type { EntryText } from './memory/transcript.ts'
import {
  AlwaysLoadedMemory,
  createWorkingMemoryExtension,
  MEMORY_AGENT_NAME,
} from './memory/working.ts'
import type { WorkingMemoryDeps } from './memory/working.ts'
import { openLocalDb } from './storage/local.ts'
import type { LocalDb } from './storage/local.ts'
import type { AgentEnv } from './env.ts'
import type {
  AgentConfig,
  AgentSnapshot,
  SendMessageRequest,
  SendMessageResponse,
  SubmissionStatus,
} from './protocol.ts'
import { parseAgentId, parseInput, parseMessage, parseRequestId } from './validation.ts'

const context = BACKGROUND_CONTEXT

/** An agent idle this long gets its new entries extracted into long-term memory. */
export const EXTRACT_IDLE_DELAY_MS = 10 * 60_000
/** Where an agent's `sharedSpaces` are stored, next to the configuration Pi keeps. */
export const SHARED_SPACES_KEY = 'kodama:shared-spaces'

/** A page of conversation text for the memory agent's extraction. */
export interface EntryPage {
  entries: EntryText[]
  /** The last entry ID the page covered, including entries without text. */
  through: number
  end: boolean
}

/** Input is refused while the database is above the hard limit; retry after pruning. */
export const STORAGE_MAINTENANCE_ERROR =
  'storage_maintenance: the agent is archiving old history; retry later'

/** Entry IDs cross RPC as plain numbers; Pi's are non-negative integers. */
function isEntryId(value: number): value is EntryId {
  return Number.isSafeInteger(value) && value >= 0
}

async function openHarness(ctx: DurableObjectState, options: HarnessOptions): Promise<Harness> {
  const storage = await openDurableObjectSqliteStorage(ctx.storage)
  const harness = await Harness.open(
    storage,
    { ...options, onReport: (error) => console.error('Agent background task failed', error) },
    context,
  )
  void harness.closed.then((end) => {
    if (end.reason === 'failed') ctx.abort('Agent storage failed')
  })
  return harness
}

/** One named object owns one agent and its durable Pi session. */
export class Agent extends DurableObject<AgentEnv> {
  protected readonly alarms: AlarmSchedule
  readonly #recovery: RecoveryAlarm
  readonly #local: Promise<LocalDb>
  readonly #memory: AlwaysLoadedMemory
  #harness: Promise<Harness>
  #pruning: Promise<PruneOutcome> | undefined
  /** A memory change arrived while busy; refresh at the next idle moment. */
  #memoryChanged = false

  constructor(ctx: DurableObjectState, env: AgentEnv) {
    super(ctx, env)
    this.alarms = new AlarmSchedule(ctx.storage)
    this.#recovery = new RecoveryAlarm(this.alarms, () => this.onIdle())
    this.#local = openLocalDb(ctx.storage)
    this.#memory = new AlwaysLoadedMemory(this.workingMemoryDeps())
    this.#harness = ctx.blockConcurrencyWhile(async () => {
      await this.#local
      return this.#open()
    })
  }

  async #open(): Promise<Harness> {
    const harness = await openHarness(this.ctx, this.harnessOptions())
    try {
      await harness.root(context)
      await initializeAgentConfig(harness, this.defaultConfig())
      await this.afterOpen(harness)
      await this.#recovery.refresh(harness)
      return harness
    } catch (error) {
      await harness.close(context)
      throw error
    }
  }

  /**
   * Run `check` against the open harness with every other event held back; if it passes, close the
   * harness, run `mutate` in one storage transaction, and open the harness again.
   */
  async #exclusive(
    check: (harness: Harness) => Promise<boolean>,
    mutate: () => void,
  ): Promise<boolean> {
    const previous = this.#harness
    let mutated = false
    this.#harness = this.ctx.blockConcurrencyWhile(async () => {
      const harness = await previous
      if (!(await check(harness))) return harness
      await harness.close(context)
      // A failure here throws out of blockConcurrencyWhile, which resets the object.
      this.ctx.storage.transactionSync(mutate)
      mutated = true
      return this.#open()
    })
    await this.#harness
    return mutated
  }

  /** Whether pruning archives entries to R2 before deleting them. */
  protected archivesEntries(): boolean {
    return true
  }

  protected pruneDeps(): PruneDeps {
    return {
      storage: this.ctx.storage,
      env: this.env,
      agentId: () => this.agentId(),
      local: () => this.#local,
      harness: () => this.#harness,
      exclusive: (check, mutate) => this.#exclusive(check, mutate),
      archive: this.archivesEntries(),
      memoryAgent: () => this.env.MEMORY_AGENT.getByName(MEMORY_AGENT_NAME),
    }
  }

  /**
   * Archive and delete old entries until the database is under the threshold, or one run with
   * `force`. A run whose delete checks fail is retried by the prune alarm.
   */
  async prune(request: { force?: boolean } = {}): Promise<PruneOutcome> {
    if (this.#pruning !== undefined) return this.#pruning
    const run = async (): Promise<PruneOutcome> => {
      const deps = this.pruneDeps()
      let outcome = await pruneOnce(deps, { force: request.force === true })
      while (outcome === 'pruned' && request.force !== true) {
        const next = await pruneOnce(deps)
        if (next === 'nothing') break
        outcome = next
      }
      await this.alarms.set(
        'prune',
        outcome === 'deferred' ? Date.now() + PRUNE_RETRY_MS : undefined,
      )
      return outcome
    }
    this.#pruning = run().finally(() => {
      this.#pruning = undefined
    })
    return this.#pruning
  }

  /** Schedule pruning when it is due and not already scheduled; reads storage only. */
  protected async schedulePruneIfNeeded(): Promise<void> {
    if ((await this.alarms.get('prune')) !== undefined) return
    if (await needsPrune(this.ctx.storage, await this.#local)) {
      await this.alarms.set('prune', Date.now())
    }
  }

  /** This agent's ID, the name its object was created with. */
  protected agentId(): string {
    const name = this.ctx.id.name
    if (name === undefined) throw new Error('Agents are addressed by name')
    return name
  }

  protected harness(): Promise<Harness> {
    return this.#harness
  }

  protected local(): Promise<LocalDb> {
    return this.#local
  }

  protected workingMemoryDeps(): WorkingMemoryDeps {
    return {
      env: this.env,
      agentId: () => this.agentId(),
      local: () => this.#local,
      sharedSpaces: () => this.#sharedSpaces(),
    }
  }

  /** Called while the object starts; subclasses supply their own registry and settings. */
  protected harnessOptions(): HarnessOptions {
    const options = createAgentOptions(this.env, [
      createWorkingMemoryExtension(this.workingMemoryDeps(), this.#memory),
    ])
    // The only files a working agent sees are its skills, read-only.
    return {
      ...options,
      env: async () => new SkillsEnv(this.env.ARCHIVE, await this.#memory.skills()),
    }
  }

  async #sharedSpaces(): Promise<string[]> {
    const stored = v.safeParse(sharedSpacesSchema, await this.ctx.storage.get(SHARED_SPACES_KEY))
    return stored.success ? stored.output : this.defaultConfig().sharedSpaces
  }

  protected defaultConfig(): AgentConfig {
    return defaultAgentConfig(this.env)
  }

  /** Runs once the harness is open, before the object serves requests. */
  protected async afterOpen(_harness: Harness): Promise<void> {
    await this.#refreshMemory(() => this.#memory.refresh())
  }

  /** Runs whenever Pi has no runnable task left. */
  protected async onIdle(): Promise<void> {
    await this.alarms.set('extract', Date.now() + EXTRACT_IDLE_DELAY_MS)
    await this.schedulePruneIfNeeded()
    if (!this.#memoryChanged) return
    this.#memoryChanged = false
    await this.#refreshMemory(() => this.#memory.refresh())
  }

  /** Memory is an aid: a failing refresh is logged and the agent keeps working. */
  async #refreshMemory(refresh: () => Promise<void>): Promise<void> {
    try {
      await refresh()
    } catch (error) {
      console.error('Long-term memory refresh failed', error)
    }
  }

  async #isIdle(harness: Harness): Promise<boolean> {
    const { tasks, submissions } = await harness.inspect(context)
    return tasks.length === 0 && submissions.length === 0
  }

  /**
   * Durably admit input. The recovery alarm is persisted first, which also covers the window
   * between admission and Pi's scheduler.
   */
  protected async admit(draft: SubmissionDraft): Promise<Submission> {
    const harness = await this.#harness
    const conversation = await harness.root(context)
    const submission = await this.#recovery.serialize(async () => {
      await this.#recovery.arm()
      return conversation.submit(draft, context)
    })
    await this.#recovery.refresh(harness)
    return submission
  }

  async sendMessage(request: SendMessageRequest): Promise<number> {
    const message = parseMessage(request)
    const limits = await pruneLimits(this.ctx.storage)
    if (this.ctx.storage.sql.databaseSize > limits.hardBytes) {
      await this.alarms.setNoLaterThan('prune', Date.now())
      throw new Error(STORAGE_MAINTENANCE_ERROR)
    }
    const harness = await this.#harness
    const config = await readAgentConfig(harness, await this.#sharedSpaces())
    if (!(await createAgentModels(this.env).checkAuth(config.model.provider))) {
      throw new Error(`Credentials are not configured for provider: ${config.model.provider}`)
    }
    if (await this.#isIdle(harness)) {
      await this.#refreshMemory(() => this.#memory.refreshIfChanged())
    }
    const submission = await this.admit({
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
    return readAgentConfig(await this.#harness, await this.#sharedSpaces())
  }

  async subscribe(): Promise<ReadableStream<Uint8Array>> {
    return subscribeEvents(await this.#harness)
  }

  /** Replace configuration while idle; history and request receipts are retained. */
  async setConfig(value: AgentConfig): Promise<AgentConfig> {
    const config = parseInput(agentConfigSchema(createAgentModels(this.env)), value)
    const harness = await this.#harness
    return this.#recovery.serialize(async () => {
      const { tasks } = await harness.inspect(context)
      if (tasks.length > 0)
        throw new Error('Agent is busy; retry configuration after it becomes idle')
      await harness.commit(
        (tx) => configure(tx, ROOT_CONVERSATION_ID, agentChange(config)),
        context,
      )
      await this.ctx.storage.put(SHARED_SPACES_KEY, config.sharedSpaces)
      // The spaces decide what the always-loaded memory and the skills list hold.
      await this.#refreshMemory(() => this.#memory.refresh())
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
    await this.#recovery.refresh(harness)
  }

  /** Deliver to another agent through DO RPC; acceptance does not wait for its model response. */
  async sendTo(agentId: string, request: SendMessageRequest): Promise<SendMessageResponse> {
    parseAgentId(agentId)
    const message = parseMessage(request)
    const submissionId = await this.env.AGENTS.getByName(agentId).sendMessage(message)
    return { agentId, requestId: message.requestId, submissionId }
  }

  async snapshot(): Promise<AgentSnapshot> {
    const harness = await this.#harness
    const stream = await watchEvents(harness, ROOT_CONVERSATION_ID, context)
    try {
      return toAgentSnapshot(stream.snapshot)
    } finally {
      await stream.stop()
    }
  }

  async submission(requestId: string): Promise<SubmissionStatus | undefined> {
    parseRequestId(requestId)
    const harness = await this.#harness
    const submission = await harness.commit(
      (tx) => tx.submissionByRequest(ROOT_CONVERSATION_ID, requestId),
      context,
    )
    return submission === undefined ? undefined : toSubmissionStatus(requestId, submission)
  }

  /**
   * Conversation text after entry `after`, oldest first, for the memory agent. Pruned entries are
   * read back from their archived segment.
   */
  async readEntries(request: { after: number; limit: number }): Promise<EntryPage> {
    const limit = Math.min(Math.max(1, request.limit), 200)
    const first = request.after + 1
    if (!isEntryId(first)) throw new TypeError('after must be an entry ID')
    const pruned = prunedThrough(await this.#local)
    if (first <= pruned) return this.#readArchived(request.after, limit, pruned)
    const harness = await this.#harness
    const page = await harness.commit(
      (tx) =>
        tx.scanEntries(
          { conversationId: ROOT_CONVERSATION_ID, minEntryId: first, order: 'ascending' },
          limit,
        ),
      context,
    )
    return {
      entries: page.items.flatMap((entry) => entryText(entry) ?? []),
      through: page.items.at(-1)?.id ?? request.after,
      end: page.next === undefined,
    }
  }

  async #readArchived(after: number, limit: number, pruned: number): Promise<EntryPage> {
    const segment = await memoryDb(this.env.MEMORY_DB)
      .select()
      .from(archiveSegments)
      .where(and(eq(archiveSegments.agentId, this.agentId()), gt(archiveSegments.lastEntry, after)))
      .orderBy(asc(archiveSegments.firstEntry))
      .limit(1)
      .get()
    // Without an archive (the memory agent's own history), the pruned range has no text left.
    if (segment === undefined || segment.firstEntry > pruned) {
      return { entries: [], through: pruned, end: false }
    }
    const page = await readArchivedText(this.env.ARCHIVE, segment.r2Prefix, after, limit)
    return { entries: page.entries, through: page.through ?? segment.lastEntry, end: false }
  }

  /** The memory agent changed this agent's memory; the copy is refreshed while idle. */
  async memoryChanged(): Promise<void> {
    const harness = await this.#harness
    if (await this.#isIdle(harness)) await this.#refreshMemory(() => this.#memory.refresh())
    else this.#memoryChanged = true
  }

  /** Hand new entries to the memory agent once the agent has been idle for a while. */
  async #extract(): Promise<void> {
    const harness = await this.#harness
    if (!(await this.#isIdle(harness))) return
    const agentId = this.agentId()
    const latest = await harness.commit(async (tx) => {
      const page = await tx.scanEntries(
        { conversationId: ROOT_CONVERSATION_ID, order: 'descending' },
        1,
      )
      return page.items[0]?.id
    }, context)
    const checkpoint = await extractionCheckpoint(memoryDb(this.env.MEMORY_DB), agentId)
    if (latest === undefined || latest <= checkpoint) return
    await this.env.MEMORY_AGENT.getByName(MEMORY_AGENT_NAME).enqueue({
      kind: 'extract',
      sourceAgentId: agentId,
      afterEntry: checkpoint,
    })
  }

  /** Handle a due alarm purpose; subclasses add their own. */
  protected async onAlarm(purpose: AlarmPurpose): Promise<void> {
    if (purpose === 'extract') await this.#extract()
    if (purpose === 'prune') await this.prune()
  }

  override async alarm(): Promise<void> {
    // Take due purposes first: the recovery refresh reschedules extraction when it finds the agent idle.
    const due = await this.alarms.take(Date.now())
    await this.#recovery.refresh(await this.#harness)
    for (const purpose of due) await this.onAlarm(purpose)
  }
}
