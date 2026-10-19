import { DurableObject } from 'cloudflare:workers'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { configure, Harness, ROOT_CONVERSATION_ID, watchEvents } from '@earendil-works/pi-durable'
import { openDurableObjectSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/cloudflare'
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

async function openHarness(ctx: DurableObjectState, env: AgentEnv): Promise<Harness> {
  const storage = await openDurableObjectSqliteStorage(ctx.storage)
  const harness = await Harness.open(
    storage,
    {
      ...createAgentOptions(env),
      onReport: (error) => console.error('Agent background task failed', error),
    },
    context,
  )
  void harness.closed.then((end) => {
    if (end.reason === 'failed') ctx.abort('Agent storage failed')
  })
  return harness
}

/** One named object owns one agent and its durable Pi session. */
export class Agent extends DurableObject<AgentEnv> {
  readonly #ready: Promise<Harness>
  readonly #recovery: RecoveryAlarm

  constructor(ctx: DurableObjectState, env: AgentEnv) {
    super(ctx, env)
    this.#recovery = new RecoveryAlarm(ctx.storage)
    this.#ready = ctx.blockConcurrencyWhile(async () => {
      const harness = await openHarness(ctx, env)
      try {
        await harness.root(context)
        await initializeAgentConfig(harness, defaultAgentConfig(env))
        await this.#recovery.refresh(harness)
        return harness
      } catch (error) {
        await harness.close(context)
        throw error
      }
    })
  }

  async sendMessage(request: SendMessageRequest): Promise<number> {
    const message = parseMessage(request)
    const harness = await this.#ready
    const conversation = await harness.root(context)
    // Persist a wakeup before admitting input, including the admission-to-scheduler crash window.
    const submission = await this.#recovery.serialize(async () => {
      const config = await readAgentConfig(harness)
      if (!(await createAgentModels(this.env).checkAuth(config.model.provider))) {
        throw new Error(`Credentials are not configured for provider: ${config.model.provider}`)
      }
      await this.#recovery.arm()
      return conversation.submit(
        {
          type: 'input',
          requestId: message.requestId,
          content: message.content,
          whenBusy: message.whenBusy ?? 'followUp',
        },
        context,
      )
    })
    await this.#recovery.refresh(harness)
    return submission.id
  }

  async send(request: SendMessageRequest): Promise<ReadableStream<Uint8Array>> {
    const message = parseMessage(request)
    return sendEvents(await this.#ready, message.requestId, () => this.sendMessage(message))
  }

  async getConfig(): Promise<AgentConfig> {
    return readAgentConfig(await this.#ready)
  }

  async subscribe(): Promise<ReadableStream<Uint8Array>> {
    return subscribeEvents(await this.#ready)
  }

  /** Replace configuration while idle; history and request receipts are retained. */
  async setConfig(value: AgentConfig): Promise<AgentConfig> {
    const config = parseInput(agentConfigSchema(createAgentModels(this.env)), value)
    const harness = await this.#ready
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
    const harness = await this.#ready
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
    const harness = await this.#ready
    const stream = await watchEvents(harness, ROOT_CONVERSATION_ID, context)
    try {
      return toAgentSnapshot(stream.snapshot)
    } finally {
      await stream.stop()
    }
  }

  async submission(requestId: string): Promise<SubmissionStatus | undefined> {
    parseRequestId(requestId)
    const harness = await this.#ready
    const submission = await harness.commit(
      (tx) => tx.submissionByRequest(ROOT_CONVERSATION_ID, requestId),
      context,
    )
    return submission === undefined ? undefined : toSubmissionStatus(requestId, submission)
  }

  override async alarm(): Promise<void> {
    await this.#recovery.refresh(await this.#ready)
  }
}
