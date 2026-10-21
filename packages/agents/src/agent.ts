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
} from './configuration/index.ts'
import { createAgentModels } from './models/index.ts'
import { toAgentSnapshot, toSubmissionStatus } from './projection.ts'
import { RecoveryAlarm } from './recovery.ts'
import { extractionCheckpoint, memoryDb } from './memory/records.ts'
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
/** Shared spaces every agent reads until agents choose their own. */
const DEFAULT_SHARED_SPACES: readonly string[] = ['global']

/** A page of conversation text for the memory agent's extraction. */
export interface EntryPage {
  entries: EntryText[]
  /** The last entry ID the page covered, including entries without text. */
  through: number
  end: boolean
}

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
  readonly #harness: Promise<Harness>
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
      const harness = await openHarness(ctx, this.harnessOptions())
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
    })
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
      sharedSpaces: () => Promise.resolve(DEFAULT_SHARED_SPACES),
    }
  }

  /** Called while the object starts; subclasses supply their own registry and settings. */
  protected harnessOptions(): HarnessOptions {
    return createAgentOptions(this.env, [
      createWorkingMemoryExtension(this.workingMemoryDeps(), this.#memory),
    ])
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
    const harness = await this.#harness
    const config = await readAgentConfig(harness)
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
    return readAgentConfig(await this.#harness)
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

  /** Conversation text after entry `after`, oldest first, for the memory agent. */
  async readEntries(request: { after: number; limit: number }): Promise<EntryPage> {
    const harness = await this.#harness
    const limit = Math.min(Math.max(1, request.limit), 200)
    const first = request.after + 1
    if (!isEntryId(first)) throw new TypeError('after must be an entry ID')
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
  }

  override async alarm(): Promise<void> {
    // Take due purposes first: the recovery refresh reschedules extraction when it finds the agent idle.
    const due = await this.alarms.take(Date.now())
    await this.#recovery.refresh(await this.#harness)
    for (const purpose of due) await this.onAlarm(purpose)
  }
}
