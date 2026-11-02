/**
 * The agents Worker's single default entrypoint: `AgentService` for conversation and management
 * RPC, alongside the `Agent` Durable Object class.
 *
 * @see docs/agents.md — RPC contract
 *
 * @module
 */
import { safeFailure } from './lib/errors.ts'
import type { ArtifactMetadata, ArtifactUpload } from './extensions.ts'
import type { CredentialRefs } from './protocol.ts'
import type { OwnerReply } from './owner-intake.ts'
import { WorkerEntrypoint } from 'cloudflare:workers'
import * as credentialFlows from './credentials/management.ts'
import { assignCredential } from './credentials/assignments.ts'
import type { AgentEnv } from './env.ts'
import type {
  AgentSnapshotResponse,
  NotificationPage,
  NotificationQuery,
  NotificationRead,
  SendMessageRequest,
  SendMessageResponse,
  SubmissionResponse,
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
import { reconcileAgents } from './control-plane/workflows/reconcile.ts'
import { aggregateUsage } from './control-plane/workflows/usage.ts'
import { readUsage } from './control-plane/usage.ts'
import { UsageQuerySchema, AuditQuerySchema } from './validation.ts'
import type { UsageQuery, AuditQuery } from './protocol.ts'
import { readAudit } from './control-plane/audit.ts'
import { managementDb } from './control-plane/db.ts'
import type { AgentUse } from './control-plane/lifecycle.ts'
import { admitAgent } from './control-plane/registry.ts'
import { MEMORY_AGENT_NAME } from './memory/jobs.ts'
import { createAgentModels } from './control-plane/models.ts'
import * as flows from './control-plane/workflows/agents.ts'
import type { ManagementCall } from './control-plane/workflows/agents.ts'
import { seed } from './control-plane/workflows/seed.ts'
import { installationId } from './control-plane/installation.ts'
import {
  CreateAgentSchema,
  UpdateConfigSchema,
  RollbackConfigSchema,
  ListFilterSchema,
  HistoryPageSchema,
  RenameAgentSchema,
  NotificationQuerySchema,
  NotificationReadSchema,
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
 * authenticates access to this single-operator installation. No user identity is accepted from
 * callers or model arguments. Direct input provenance is stamped by this host after admission.
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
        models: createAgentModels(),
        source: 'system',
        now: controller.scheduledTime,
      })
      if (result.behind > 0) console.warn('Agents still behind their configuration', result)
    } catch (error) {
      console.error('Configuration reconciliation failed', safeFailure(error))
    }
    try {
      await aggregateUsage({ ...this.#systemCall(), now: controller.scheduledTime })
    } catch (error) {
      console.error('Usage sweep failed', safeFailure(error))
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

  /** Internal automation is distinguishable in audit without inventing a user identity. */
  #systemCall(): ManagementCall {
    return {
      env: this.env,
      db: managementDb(this.env.MANAGEMENT_DB),
      models: createAgentModels(),
      source: 'system',
      now: Date.now(),
    }
  }

  /** The private service binding is the authenticated operator boundary. */
  #call(): ManagementCall {
    return { ...this.#systemCall(), source: 'operator' }
  }

  /** Admit a sequenced owner reply or cancel through the existing conversation machinery. */
  async ownerReply(agentId: string, input: OwnerReply) {
    const agent = await this.#agent(agentId, input.action === 'cancel' ? 'read' : 'chat')
    using result = await agent.ownerReply(input)
    const { requestId, submissionId, state } = result
    return { requestId, submissionId, state }
  }

  /** Read receipt references and the next agent-wide reply sequence; no implicit receipt or read. */
  async ownerDeliveries(agentId: string) {
    const agent = await this.#agent(agentId, 'read')
    using result = await agent.ownerDeliveries()
    return { deliveries: Array.from(result.deliveries), nextSequence: result.nextSequence }
  }

  /** The UI Worker reports its own receipt, independently of browser display and inbox read. */
  async reportOwnerDelivery(agentId: string, input: { id: string; state: 'accepted' | 'failed' }) {
    const agent = await this.#agent(agentId, 'read')
    using result = await agent.reportOwnerDelivery(input)
    const { id, source, sourceId, state, createdAt, updatedAt } = result
    return { id, source, sourceId, state, createdAt, updatedAt }
  }

  /** Return existing execution/contact waits and delivery failures with available owner actions. */
  async attention(agentId: string) {
    const agent = await this.#agent(agentId, 'read')
    using result = await agent.attention()
    return Array.from(result)
  }

  /** Read retained management events without exposing credential envelopes or appending read events. */
  async audit(request: AuditQuery) {
    const call = this.#call()
    return readAudit(call.db, parseInput(AuditQuerySchema, request))
  }

  /** Catalog-priced usage, with subscription references and incomplete measurements separated. */
  async usage(request: UsageQuery) {
    const call = this.#call()
    return readUsage(call.db, parseInput(UsageQuerySchema, request), call.now)
  }

  /** Lazily obtain the installation identity for authentication without creating agents. */
  async getInstallationId(): Promise<string> {
    const call = this.#call()
    return installationId(call.db, call.now)
  }

  /**
   * Create the installation's starting rows if missing: the installation ID, the memory agent with
   * its version 1, and the first agent. Idempotent.
   */
  async seed(credentials?: CredentialRefs): Promise<SeedResult> {
    return seed(this.#call(), credentials)
  }

  /**
   * Create a working agent; the server assigns its UUID.
   *
   * @throws {@link TypeError} When the request is invalid or the slug is taken.
   */
  async createAgent(request: CreateAgentRequest): Promise<AgentSummary> {
    const call = this.#call()
    const input = parseInput(CreateAgentSchema, request)
    return flows.createAgent(call, {
      requestId: input.requestId,
      displayName: input.displayName,
      ...(input.slug === undefined ? {} : { slug: input.slug }),
      ...(input.settings === undefined ? {} : { settings: input.settings }),
      ...(input.credentials === undefined ? {} : { credentials: input.credentials }),
    })
  }

  /** Registry rows, newest first, with desired and applied versions. */
  async listAgents(
    filter: { kind?: 'working' | 'dedicated'; status?: AgentStatus } = {},
  ): Promise<AgentSummary[]> {
    return flows.listAgents(this.#call(), parseInput(ListFilterSchema, filter))
  }

  /**
   * One registry row, with desired and applied versions.
   *
   * @throws {@link TypeError} When the agent is unknown.
   */
  async getAgent(agentId: string): Promise<AgentSummary> {
    return flows.getAgent(this.#call(), parseAgentId(agentId))
  }

  /**
   * The agent a UUID, slug, or unique UUID prefix names.
   *
   * @throws {@link TypeError} When nothing matches, or a prefix is ambiguous (with candidates).
   */
  async resolveAgent(ref: string): Promise<AgentSummary> {
    return flows.resolveAgent(this.#call(), parseAgentRef(ref))
  }

  /**
   * Change the display name or slug; the UUID never changes.
   *
   * @throws {@link TypeError} When the agent is unknown, the change is invalid, or the slug is taken.
   */
  async renameAgent(agentId: string, change: RenameAgentRequest): Promise<AgentSummary> {
    return flows.renameAgent(
      this.#call(),
      parseAgentId(agentId),
      parseInput(RenameAgentSchema, change),
    )
  }

  /**
   * The desired configuration version.
   *
   * @throws {@link TypeError} When the agent is unknown.
   */
  async getConfig(agentId: string): Promise<ConfigVersion> {
    return flows.getConfig(this.#call(), parseAgentId(agentId))
  }

  /**
   * Write a new version on top of `expectedVersion` and push it; it applies from the agent's next
   * turn.
   *
   * @throws {@link TypeError} When the agent is unknown or the request is invalid.
   * @throws {@link Error} Starting `version_conflict:`, when another version was written first.
   */
  async updateConfig(agentId: string, request: UpdateConfigRequest): Promise<ConfigWriteResult> {
    const call = this.#call()
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
    agentId: string,
    page: { before?: number; limit?: number } = {},
  ): Promise<ConfigVersion[]> {
    return flows.configHistory(
      this.#call(),
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
    agentId: string,
    request: RollbackConfigRequest,
  ): Promise<ConfigWriteResult> {
    const call = this.#call()
    const input = parseInput(RollbackConfigSchema, request)
    return flows.rollbackConfig(call, parseAgentId(agentId), {
      requestId: input.requestId,
      toVersion: input.toVersion,
      expectedVersion: input.expectedVersion,
      ...(input.comment === undefined ? {} : { comment: input.comment }),
    })
  }

  /** Register an encrypted API credential; returns metadata only. */
  async putCredential(request: unknown) {
    return credentialFlows.credentialRpc(async () =>
      credentialFlows.putCredential(this.#call(), this.env, request),
    )
  }

  /** List credential metadata under the common management caller contract. */
  async listCredentials() {
    return credentialFlows.credentialRpc(async () => credentialFlows.listCredentials(this.#call()))
  }

  /** Preview affected agents before revoking a credential. */
  async credentialCoverage(credentialId: string) {
    return credentialFlows.credentialRpc(async () =>
      credentialFlows.credentialCoverage(this.#call(), credentialId),
    )
  }

  /** Grant an agent permission to use a credential without selecting it. */
  async grantCredential(credentialId: string, agentId: string) {
    return credentialFlows.credentialRpc(async () =>
      credentialFlows.grantCredential(this.#call(), credentialId, agentId),
    )
  }

  /** Select a credential in one agent or all current agents, writing configuration versions. */
  async assignCredential(credentialId: string, target: string) {
    return credentialFlows.credentialRpc(async () =>
      assignCredential(this.#call(), credentialId, target),
    )
  }

  /** Remove one agent's permission and selection without revoking other agents' access. */
  async unassignCredential(credentialId: string, agentId: string) {
    return credentialFlows.credentialRpc(async () =>
      assignCredential(this.#call(), credentialId, agentId, true),
    )
  }

  /** Disable a credential and clear its envelope with an atomic D1 audit record. */
  async revokeCredential(credentialId: string) {
    return credentialFlows.credentialRpc(async () =>
      credentialFlows.revokeCredential(this.#call(), credentialId),
    )
  }

  /** Store arbitrary bytes under the admitted working agent; no public URL is created. */
  async uploadArtifact(agentId: string, input: ArtifactUpload): Promise<ArtifactMetadata> {
    using result = await (await this.#agent(agentId, 'chat')).uploadArtifact(input)
    const { artifactId, filename, mediaType, size, createdAt, expiresAt } = result
    return { artifactId, filename, mediaType, size, createdAt, expiresAt }
  }

  /** Page only this agent's ready, unexpired metadata. */
  async listArtifacts(
    agentId: string,
    page: { cursor?: string; limit?: number } = {},
  ): Promise<ArtifactMetadata[]> {
    using result = await (await this.#agent(agentId, 'read')).listArtifacts(page)
    return Array.from(result)
  }

  /** Download binary data; the calling Worker must not render active content inline. */
  async downloadArtifact(
    agentId: string,
    artifactId: string,
  ): Promise<ArtifactMetadata & { bytes: Uint8Array }> {
    using result = await (await this.#agent(agentId, 'read')).downloadArtifact(artifactId)
    const { filename, mediaType, size, createdAt, expiresAt, bytes } = result
    return { artifactId, filename, mediaType, size, createdAt, expiresAt, bytes }
  }

  /** Retryable deletion; absent local IDs are no-ops, but corrupt owner keys reject. */
  async deleteArtifact(agentId: string, artifactId: string): Promise<void> {
    return (await this.#agent(agentId, 'read')).deleteArtifact(artifactId)
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

  /** List the admitted working agent's inbox; paused and archived agents remain readable. */
  async notifications(agentId: string, query: NotificationQuery = {}): Promise<NotificationPage> {
    const input = parseInput(NotificationQuerySchema, query)
    using page = await (await this.#agent(agentId, 'read')).notifications(input)
    return {
      notifications: page.notifications,
      ...(page.nextBefore === undefined ? {} : { nextBefore: page.nextBefore }),
    }
  }

  /** Acknowledge one exact sequence agent-wide without deleting the referenced result. */
  async readNotification(agentId: string, request: NotificationRead): Promise<boolean> {
    const input = parseInput(NotificationReadSchema, request)
    return (await this.#agent(agentId, 'read')).readNotification(input)
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
