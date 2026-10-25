/**
 * The agents Worker's single default entrypoint: `AgentService` for conversation and management
 * RPC, alongside the `Agent` Durable Object class.
 *
 * @see docs/agents.md — RPC contract
 *
 * @module
 */
import { WorkerEntrypoint } from 'cloudflare:workers'
import * as credentialFlows from './credentials/management.ts'
import { assignCredential } from './credentials/assignments.ts'
import type { AgentEnv } from './env.ts'
import type {
  AgentSnapshotResponse,
  SendMessageRequest,
  SendMessageResponse,
  SubmissionResponse,
  ManagementActor,
  AgentStatus,
  AgentSummary,
  ConfigVersion,
  ConfigWriteResult,
  CreateAgentRequest,
  RenameAgentRequest,
  RollbackConfigRequest,
  SeedResult,
  UpdateConfigRequest,
} from './protocol.ts'
import { reconcileAgents } from './management/service/reconcile.ts'
import { managementDb } from './management/db.ts'
import type { AgentUse } from './management/lifecycle.ts'
import { admitAgent } from './management/registry.ts'
import { MEMORY_AGENT_NAME } from './memory/jobs.ts'
import { createAgentModels } from './models/index.ts'
import type { PrincipalRow } from './management/db.ts'
import { principalOf } from './management/principals.ts'
import * as flows from './management/service/agents.ts'
import type { ManagementCall } from './management/service/agents.ts'
import { seed } from './management/service/seed.ts'
import {
  CreateAgentSchema,
  UpdateConfigSchema,
  RollbackConfigSchema,
  ListFilterSchema,
  HistoryPageSchema,
  RenameAgentSchema,
  parseManagementActor,
  parseAgentId,
  parseAgentRef,
  parseInput,
} from './validation.ts'

/**
 * The one Durable Object class, bound as `AGENTS`: a working agent, or the dedicated agent registered
 * under the object's name, such as the memory agent.
 */
export { AgentObject as Agent } from './agent-object.ts'

/**
 * Service-binding RPC entrypoint for the UI server and other trusted Workers.
 *
 * @remarks
 * Conversation methods admit registered working-agent UUIDs before forwarding to Durable Objects;
 * unknown IDs never create objects, and dedicated agents cannot be addressed through those methods.
 * Management methods validate their input and call the registry flows. The calling Worker
 * authenticates callers and supplies their actor; all management methods except seed resolve that
 * actor to a principal and reject disabled principals. Roles and permissions are issue #7.
 * There is no public HTTP interface.
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

  /** The call of the system, before any principal exists. */
  #systemCall(): ManagementCall {
    return {
      env: this.env,
      db: managementDb(this.env.MANAGEMENT_DB),
      models: createAgentModels(this.env),
      principal: null,
      now: Date.now(),
    }
  }

  /**
   * The call of `actor`, as the principal it names.
   *
   * @throws {@link TypeError} When `actor` is malformed.
   * @throws {@link Error} Starting `forbidden:`, when the principal is disabled.
   */
  async #call(actor: unknown): Promise<ManagementCall & { principal: PrincipalRow }> {
    const call = this.#systemCall()
    const principal = await principalOf(call.db, parseManagementActor(actor), call.now)
    return { ...call, principal }
  }

  /**
   * Create the installation's starting rows if missing: the installation ID, the memory agent with
   * its version 1, and the first agent. Idempotent.
   */
  async seed(): Promise<SeedResult> {
    return seed(this.#systemCall())
  }

  /**
   * Create a working agent; the server assigns its UUID.
   *
   * @throws {@link TypeError} When the request is invalid or the slug is taken.
   */
  async createAgent(actor: ManagementActor, request: CreateAgentRequest): Promise<AgentSummary> {
    const call = await this.#call(actor)
    const input = parseInput(CreateAgentSchema, request)
    return flows.createAgent(call, {
      requestId: input.requestId,
      displayName: input.displayName,
      ...(input.slug === undefined ? {} : { slug: input.slug }),
      ...(input.settings === undefined ? {} : { settings: input.settings }),
    })
  }

  /** Registry rows, newest first, with desired and applied versions. */
  async listAgents(
    actor: ManagementActor,
    filter: { kind?: 'working' | 'dedicated'; status?: AgentStatus } = {},
  ): Promise<AgentSummary[]> {
    return flows.listAgents(await this.#call(actor), parseInput(ListFilterSchema, filter))
  }

  /**
   * One registry row, with desired and applied versions.
   *
   * @throws {@link TypeError} When the agent is unknown.
   */
  async getAgent(actor: ManagementActor, agentId: string): Promise<AgentSummary> {
    return flows.getAgent(await this.#call(actor), parseAgentId(agentId))
  }

  /**
   * The agent a UUID, slug, or unique UUID prefix names.
   *
   * @throws {@link TypeError} When nothing matches, or a prefix is ambiguous (with candidates).
   */
  async resolveAgent(actor: ManagementActor, ref: string): Promise<AgentSummary> {
    return flows.resolveAgent(await this.#call(actor), parseAgentRef(ref))
  }

  /**
   * Change the display name or slug; the UUID never changes.
   *
   * @throws {@link TypeError} When the agent is unknown, the change is invalid, or the slug is taken.
   */
  async renameAgent(
    actor: ManagementActor,
    agentId: string,
    change: RenameAgentRequest,
  ): Promise<AgentSummary> {
    return flows.renameAgent(
      await this.#call(actor),
      parseAgentId(agentId),
      parseInput(RenameAgentSchema, change),
    )
  }

  /**
   * The desired configuration version.
   *
   * @throws {@link TypeError} When the agent is unknown.
   */
  async getConfig(actor: ManagementActor, agentId: string): Promise<ConfigVersion> {
    return flows.getConfig(await this.#call(actor), parseAgentId(agentId))
  }

  /**
   * Write a new version on top of `expectedVersion` and push it; it applies from the agent's next
   * turn.
   *
   * @throws {@link TypeError} When the agent is unknown or the request is invalid.
   * @throws {@link Error} Starting `version_conflict:`, when another version was written first.
   */
  async updateConfig(
    actor: ManagementActor,
    agentId: string,
    request: UpdateConfigRequest,
  ): Promise<ConfigWriteResult> {
    const call = await this.#call(actor)
    const input = parseInput(UpdateConfigSchema, request)
    return flows.updateConfig(call, parseAgentId(agentId), {
      requestId: input.requestId,
      settings: input.settings,
      expectedVersion: input.expectedVersion,
      ...(input.comment === undefined ? {} : { comment: input.comment }),
    })
  }

  /** Versions newest first: who changed what, and when. */
  async configHistory(
    actor: ManagementActor,
    agentId: string,
    page: { before?: number; limit?: number } = {},
  ): Promise<ConfigVersion[]> {
    return flows.configHistory(
      await this.#call(actor),
      parseAgentId(agentId),
      parseInput(HistoryPageSchema, page),
    )
  }

  /**
   * Write the settings of `toVersion` as a new version and push it.
   *
   * @throws {@link TypeError} When the agent or the version is unknown.
   * @throws {@link Error} Starting `version_conflict:`, when another version was written first.
   */
  async rollbackConfig(
    actor: ManagementActor,
    agentId: string,
    request: RollbackConfigRequest,
  ): Promise<ConfigWriteResult> {
    const call = await this.#call(actor)
    const input = parseInput(RollbackConfigSchema, request)
    return flows.rollbackConfig(call, parseAgentId(agentId), {
      requestId: input.requestId,
      toVersion: input.toVersion,
      expectedVersion: input.expectedVersion,
      ...(input.comment === undefined ? {} : { comment: input.comment }),
    })
  }

  /** Register an encrypted API credential; returns metadata only. */
  async putCredential(actor: ManagementActor, request: unknown) {
    return credentialFlows.putCredential(await this.#call(actor), this.env, request)
  }

  /** List credential metadata under the common management caller contract. */
  async listCredentials(actor: ManagementActor) {
    return credentialFlows.listCredentials(await this.#call(actor))
  }

  /** Preview affected agents before revoking a credential. */
  async credentialCoverage(actor: ManagementActor, credentialId: string) {
    return credentialFlows.credentialCoverage(await this.#call(actor), credentialId)
  }

  /** Grant an agent permission to use a credential without selecting it. */
  async grantCredential(actor: ManagementActor, credentialId: string, agentId: string) {
    return credentialFlows.grantCredential(await this.#call(actor), credentialId, agentId)
  }

  /** Select a credential in one agent or all current agents, writing configuration versions. */
  async assignCredential(actor: ManagementActor, credentialId: string, target: string) {
    return assignCredential(await this.#call(actor), credentialId, target)
  }

  /** Remove one agent's permission and selection without revoking other agents' access. */
  async unassignCredential(actor: ManagementActor, credentialId: string, agentId: string) {
    return assignCredential(await this.#call(actor), credentialId, agentId, true)
  }

  /** Disable a credential; success requires its R2 revocation record to be durable. */
  async revokeCredential(actor: ManagementActor, credentialId: string) {
    return credentialFlows.revokeCredential(await this.#call(actor), this.env, credentialId)
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
