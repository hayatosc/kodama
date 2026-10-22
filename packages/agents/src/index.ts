/**
 * The agents Worker's entrypoint: `AgentService` for trusted Workers, and the `Agent` Durable
 * Object class.
 *
 * @see docs/agents.md — RPC contract
 *
 * @module
 */
import { WorkerEntrypoint } from 'cloudflare:workers'
import type { AgentEnv } from './env.ts'
import type {
  AgentSnapshotResponse,
  AgentConfig,
  SendMessageRequest,
  SendMessageResponse,
  SubmissionResponse,
} from './protocol.ts'
import { MEMORY_AGENT_NAME } from './memory/jobs.ts'
import { parseAgentId } from './validation.ts'

/** The Durable Object class of every agent, including the memory agent. */
export { Agent } from './agent/agent.ts'

/**
 * Service-binding RPC entrypoint for the UI server and other trusted Workers.
 *
 * @remarks
 * Each method validates the agent ID and forwards to that agent's Durable Object. There is no
 * public HTTP interface; the memory agent's reserved name is not a valid agent ID, so this class
 * cannot reach it.
 */
export default class AgentService extends WorkerEntrypoint<AgentEnv> {
  /** Reject HTTP requests: agents are reached only through RPC. */
  override async fetch(_request: Request): Promise<Response> {
    return new Response('Use a Cloudflare RPC service binding.', { status: 404 })
  }

  /** The daily cron trigger: the memory agent consolidates what changed in the last day. */
  override async scheduled(controller: ScheduledController): Promise<void> {
    await this.env.AGENTS.getByName(MEMORY_AGENT_NAME).consolidate(controller.scheduledTime)
  }

  /**
   * The agent's stub, after validating the ID at the RPC boundary.
   *
   * @throws {@link TypeError} When `agentId` is not a valid public agent ID.
   */
  #agent(agentId: string) {
    return this.env.AGENTS.getByName(parseAgentId(agentId))
  }

  /** The agent's stored configuration. */
  async getConfig(agentId: string): Promise<AgentConfig> {
    return this.#agent(agentId).getConfig()
  }

  /** An SSE stream of the agent's events, starting with a snapshot. */
  async subscribe(agentId: string): Promise<ReadableStream<Uint8Array>> {
    return this.#agent(agentId).subscribe()
  }

  /**
   * Admit a message and stream its run as SSE until its submission settles.
   *
   * @throws {@link TypeError} When the message is invalid; nothing is admitted.
   */
  async send(agentId: string, message: SendMessageRequest): Promise<ReadableStream<Uint8Array>> {
    return this.#agent(agentId).send(message)
  }

  /**
   * Replace the agent's configuration while it is idle.
   *
   * @throws {@link TypeError} When the configuration is invalid.
   * @throws When work is pending.
   */
  async setConfig(agentId: string, config: AgentConfig): Promise<AgentConfig> {
    return this.#agent(agentId).setConfig(config)
  }

  /** Stop the current run and withdraw queued input; resolves once the agent is idle. */
  async cancel(agentId: string): Promise<void> {
    return this.#agent(agentId).cancel()
  }

  /**
   * Durably admit a message without waiting for the answer.
   *
   * @remarks
   * Reusing a request ID with the same content returns the first submission.
   */
  async sendMessage(agentId: string, message: SendMessageRequest): Promise<SendMessageResponse> {
    const submissionId = await this.#agent(agentId).sendMessage(message)
    return { agentId, requestId: message.requestId, submissionId }
  }

  /** Committed user and assistant messages, and whether the agent is busy. */
  async snapshot(agentId: string): Promise<AgentSnapshotResponse> {
    using snapshot = await this.#agent(agentId).snapshot()
    return { agentId, snapshot }
  }

  /** The status of the submission with this request ID, if there is one. */
  async submission(agentId: string, requestId: string): Promise<SubmissionResponse | undefined> {
    using submission = await this.#agent(agentId).submission(requestId)
    return submission === undefined ? undefined : { agentId, submission }
  }
}
