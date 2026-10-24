/**
 * The agents Worker's entrypoint: `AgentService` for trusted Workers, `ManagementService` for
 * managing agents, and the `Agent` Durable Object class.
 *
 * @see docs/agents.md — RPC contract
 *
 * @module
 */
import { WorkerEntrypoint } from 'cloudflare:workers'
import type { AgentEnv } from './env.ts'
import type {
  AgentSnapshotResponse,
  SendMessageRequest,
  SendMessageResponse,
  SubmissionResponse,
} from './protocol.ts'
import { reconcileAgents } from './management/service/reconcile.ts'
import { managementDb } from './management/db.ts'
import type { AgentUse } from './management/lifecycle.ts'
import { admitAgent } from './management/registry.ts'
import { MEMORY_AGENT_NAME } from './memory/jobs.ts'
import { createAgentModels } from './models/index.ts'
import { parseAgentId } from './validation.ts'

/** Management: the agent registry, configuration versions, and the seed. */
export { ManagementService } from './management/service/index.ts'

/**
 * The one Durable Object class, bound as `AGENTS`: a working agent, or the dedicated agent registered
 * under the object's name, such as the memory agent.
 */
export { AgentObject as Agent } from './agent-object.ts'

/**
 * Service-binding RPC entrypoint for the UI server and other trusted Workers.
 *
 * @remarks
 * Each method validates the agent ID, admits it from the registry, and forwards to that agent's
 * Durable Object. Only UUIDs of working agents in the registry are admitted, so an unknown ID never
 * creates an object and dedicated agents such as the memory agent are unreachable. There is no
 * public HTTP interface, and configuration is read and written only through `ManagementService`.
 */
export default class AgentService extends WorkerEntrypoint<AgentEnv> {
  /** Reject HTTP requests: agents are reached only through RPC. */
  override async fetch(_request: Request): Promise<Response> {
    return new Response('Use a Cloudflare RPC service binding.', { status: 404 })
  }

  /**
   * The daily cron trigger: push configuration versions the objects have not applied, then the
   * memory agent consolidates what changed in the last day.
   */
  override async scheduled(controller: ScheduledController): Promise<void> {
    try {
      const result = await reconcileAgents({
        env: this.env,
        db: managementDb(this.env.MANAGEMENT_DB),
        models: createAgentModels(this.env),
        principal: null,
        now: controller.scheduledTime,
      })
      if (result.behind > 0) console.warn('Agents still behind their configuration', result)
    } catch (error) {
      console.error('Configuration reconciliation failed', error)
    }
    await this.env.AGENTS.getByName(MEMORY_AGENT_NAME).consolidate(controller.scheduledTime)
  }

  /**
   * The agent's stub, after validating the ID and admitting it from the registry right before the
   * call.
   *
   * @throws {@link TypeError} When `agentId` is not a UUID, or not a working agent in the registry.
   * @throws {@link Error} Starting `agent_unavailable:`, when the agent's state does not allow `use`.
   */
  async #agent(agentId: string, use: AgentUse) {
    const objectName = await admitAgent(
      managementDb(this.env.MANAGEMENT_DB),
      parseAgentId(agentId),
      use,
    )
    return this.env.AGENTS.getByName(objectName)
  }

  /** An SSE stream of the agent's events, starting with a snapshot. */
  async subscribe(agentId: string): Promise<ReadableStream<Uint8Array>> {
    return (await this.#agent(agentId, 'read')).subscribe()
  }

  /**
   * Admit a message and stream its run as SSE until its submission settles.
   *
   * @throws {@link TypeError} When the message is invalid; nothing is admitted.
   */
  async send(agentId: string, message: SendMessageRequest): Promise<ReadableStream<Uint8Array>> {
    return (await this.#agent(agentId, 'chat')).send(message)
  }

  /** Stop the current run and withdraw queued input; resolves once the agent is idle. */
  async cancel(agentId: string): Promise<void> {
    return (await this.#agent(agentId, 'read')).cancel()
  }

  /**
   * Durably admit a message without waiting for the answer.
   *
   * @remarks
   * Reusing a request ID with the same content returns the first submission.
   */
  async sendMessage(agentId: string, message: SendMessageRequest): Promise<SendMessageResponse> {
    const submissionId = await (await this.#agent(agentId, 'chat')).sendMessage(message)
    return { agentId, requestId: message.requestId, submissionId }
  }

  /** Committed user and assistant messages, and whether the agent is busy. */
  async snapshot(agentId: string): Promise<AgentSnapshotResponse> {
    using snapshot = await (await this.#agent(agentId, 'read')).snapshot()
    return { agentId, snapshot }
  }

  /** The status of the submission with this request ID, if there is one. */
  async submission(agentId: string, requestId: string): Promise<SubmissionResponse | undefined> {
    using submission = await (await this.#agent(agentId, 'read')).submission(requestId)
    return submission === undefined ? undefined : { agentId, submission }
  }
}
