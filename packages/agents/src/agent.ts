import { DurableObject } from 'cloudflare:workers'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { configure, Harness, ROOT_CONVERSATION_ID, watchEvents } from '@earendil-works/pi-durable'
import type { TaskId } from '@earendil-works/pi-durable'
import { openDurableObjectSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/cloudflare'
import { createAgentOptions } from './harness.ts'
import { sendEvents, subscribeEvents } from './events.ts'
import {
  agentChange,
  defaultAgentConfig,
  initializeAgentConfig,
  parseAgentConfig,
  readAgentConfig,
} from './configuration/index.ts'
import { createAgentModels } from './models/index.ts'
import type { AgentEnv } from './env.ts'
import type {
  AgentMessage,
  AgentConfig,
  AgentSnapshot,
  SendMessageRequest,
  SendMessageResponse,
  SubmissionStatus,
} from './protocol.ts'
import { validateId, validateMessage } from './validation.ts'

const context = BACKGROUND_CONTEXT
const RECOVERY_DELAY_MS = 60_000

/** One named object owns one agent and its durable Pi session. */
export class Agent extends DurableObject<AgentEnv> {
  readonly #ready: Promise<Harness>
  readonly #watching = new Set<TaskId>()
  #alarmUpdate: Promise<void> = Promise.resolve()

  constructor(ctx: DurableObjectState, env: AgentEnv) {
    super(ctx, env)
    this.#ready = ctx.blockConcurrencyWhile(async () => {
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
      try {
        await harness.root(context)
        await initializeAgentConfig(
          harness,
          defaultAgentConfig(env.DEFAULT_MODEL_PROVIDER, env.DEFAULT_MODEL_ID),
        )
        await this.#refreshAlarm(harness)
        return harness
      } catch (error) {
        await harness.close(context)
        throw error
      }
    })
  }

  async sendMessage(message: SendMessageRequest): Promise<number> {
    validateMessage(message)
    const harness = await this.#ready
    const conversation = await harness.root(context)
    // Persist a wakeup before admitting input, including the admission-to-scheduler crash window.
    const submission = await this.#serializeAlarmUpdate(async () => {
      const config = await readAgentConfig(harness)
      if (!(await createAgentModels(this.env).checkAuth(config.model.provider))) {
        throw new Error(`Credentials are not configured for provider: ${config.model.provider}`)
      }
      await this.ctx.storage.setAlarm(Date.now() + RECOVERY_DELAY_MS)
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
    await this.#refreshAlarm(harness)
    return submission.id
  }

  async send(message: SendMessageRequest): Promise<ReadableStream<Uint8Array>> {
    validateMessage(message)
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
    const config = parseAgentConfig(value, createAgentModels(this.env))
    const harness = await this.#ready
    return this.#serializeAlarmUpdate(async () => {
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
    await this.#refreshAlarm(harness)
  }

  /** Deliver to another agent through DO RPC; acceptance does not wait for its model response. */
  async sendTo(agentId: string, message: SendMessageRequest): Promise<SendMessageResponse> {
    validateId(agentId, 'agentId', 64)
    validateMessage(message)
    const submissionId = await this.env.AGENTS.getByName(agentId).sendMessage(message)
    return { agentId, requestId: message.requestId, submissionId }
  }

  async snapshot(): Promise<AgentSnapshot> {
    const harness = await this.#ready
    const stream = await watchEvents(harness, ROOT_CONVERSATION_ID, context)
    try {
      const snapshot = stream.snapshot
      const messages: AgentMessage[] = []
      for (const entry of snapshot.entries) {
        for (const message of entry.model ?? []) {
          if (message.role !== 'user' && message.role !== 'assistant') continue
          const text =
            typeof message.content === 'string'
              ? message.content
              : message.content
                  .filter((part) => part.type === 'text')
                  .map((part) => part.text)
                  .join('\n')
          messages.push({ entryId: entry.id, role: message.role, text })
        }
      }
      return { messages, busy: snapshot.run !== undefined || snapshot.inbox.length > 0 }
    } finally {
      await stream.stop()
    }
  }

  async submission(requestId: string): Promise<SubmissionStatus | undefined> {
    validateId(requestId, 'requestId', 128)
    const harness = await this.#ready
    const submission = await harness.commit(
      (tx) => tx.submissionByRequest(ROOT_CONVERSATION_ID, requestId),
      context,
    )
    if (submission === undefined) return undefined
    const { id } = submission
    if (submission.status !== 'unanswered') return { id, requestId, status: submission.status }
    const { status, reason, detail } = submission
    if (detail === undefined) return { id, requestId, status, reason }
    const text = typeof detail === 'string' ? detail : JSON.stringify(detail)
    return { id, requestId, status, reason, detail: text }
  }

  override async alarm(): Promise<void> {
    await this.#refreshAlarm(await this.#ready)
  }

  #serializeAlarmUpdate<T>(operation: () => Promise<T>): Promise<T> {
    const update = this.#alarmUpdate.then(operation, operation)
    this.#alarmUpdate = update.then(
      () => {},
      () => {},
    )
    return update
  }

  #refreshAlarm(harness: Harness): Promise<void> {
    return this.#serializeAlarmUpdate(async () => {
      const { tasks } = await harness.inspect(context)
      const runnable = tasks.filter((task) => task.state.kind !== 'blocked')
      if (runnable.length === 0) {
        await this.ctx.storage.deleteAlarm()
        return
      }
      await this.ctx.storage.setAlarm(Date.now() + RECOVERY_DELAY_MS)
      // waitForTask enables Pi's scheduler; the recovery alarm must already be durable.
      for (const task of runnable) {
        const id = task.record.id
        if (this.#watching.has(id)) continue
        this.#watching.add(id)
        void harness
          .waitForTask(id, context)
          .then(() => this.#refreshAlarm(harness))
          .catch((error: unknown) => console.error('Agent recovery failed', error))
          .finally(() => this.#watching.delete(id))
      }
    })
  }
}
