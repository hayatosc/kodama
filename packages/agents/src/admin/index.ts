/**
 * `AdminService`, the named entrypoint for administration: the agent registry, configuration
 * versions, and the seed. Reached only through a service binding, never over HTTP.
 *
 * @see docs/agents.md — AdminService
 *
 * @module
 */
import { WorkerEntrypoint } from 'cloudflare:workers'
import * as v from 'valibot'
import { AGENT_KINDS, AGENT_STATUSES } from '../../drizzle/management/schema.ts'
import { managementDb } from '../management/db.ts'
import type { PrincipalRow } from '../management/db.ts'
import { principalOf } from '../management/principals.ts'
import type { AgentEnv } from '../env.ts'
import { createAgentModels } from '../models/index.ts'
import type {
  AdminActor,
  AgentStatus,
  AgentSummary,
  ConfigVersion,
  ConfigWriteResult,
  CreateAgentRequest,
  RenameAgentRequest,
  RollbackConfigRequest,
  SeedResult,
  UpdateConfigRequest,
} from '../protocol.ts'
import {
  CommentSchema,
  DisplayNameSchema,
  ExpectedVersionSchema,
  parseAdminActor,
  parseAgentId,
  parseAgentRef,
  parseInput,
  RenameAgentSchema,
  RequestIdSchema,
  SlugSchema,
  VersionSchema,
} from '../validation.ts'
import * as flows from './agents.ts'
import type { AdminCall } from './agents.ts'
import { seed } from './seed.ts'

const CreateAgentSchema = v.strictObject(
  {
    requestId: RequestIdSchema,
    displayName: DisplayNameSchema,
    slug: v.optional(SlugSchema),
    // Validated against the model catalog by the flow.
    settings: v.optional(v.unknown()),
  },
  'Expected requestId and displayName',
)

const UpdateConfigSchema = v.strictObject(
  {
    requestId: RequestIdSchema,
    settings: v.unknown(),
    expectedVersion: ExpectedVersionSchema,
    comment: CommentSchema,
  },
  'Expected requestId, settings, and expectedVersion',
)

const RollbackConfigSchema = v.strictObject(
  {
    requestId: RequestIdSchema,
    toVersion: VersionSchema,
    expectedVersion: ExpectedVersionSchema,
    comment: CommentSchema,
  },
  'Expected requestId, toVersion, and expectedVersion',
)

const ListFilterSchema = v.strictObject({
  kind: v.optional(v.picklist(AGENT_KINDS)),
  status: v.optional(v.picklist(AGENT_STATUSES)),
})

const HistoryPageSchema = v.strictObject({
  before: v.optional(VersionSchema),
  limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
})

/**
 * Administration RPC for the UI Worker and the development CLI.
 *
 * @remarks
 * The calling Worker authenticates the caller and passes it as `actor`, and every method except
 * {@link AdminService.seed} trusts it: people, services, and agents call alike, so an agent can
 * create and configure agents as a person can. The actor is recorded as the author and in the audit
 * rows. Roles and permissions are issue #7.
 */
export class AdminService extends WorkerEntrypoint<AgentEnv> {
  /** Reject HTTP requests: administration is reached only through RPC. */
  override async fetch(_request: Request): Promise<Response> {
    return new Response('Use a Cloudflare RPC service binding.', { status: 404 })
  }

  /** The call of the system, before any principal exists. */
  #systemCall(): AdminCall {
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
  async #call(actor: unknown): Promise<AdminCall & { principal: PrincipalRow }> {
    const call = this.#systemCall()
    const principal = await principalOf(call.db, parseAdminActor(actor), call.now)
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
  async createAgent(actor: AdminActor, request: CreateAgentRequest): Promise<AgentSummary> {
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
    actor: AdminActor,
    filter: { kind?: 'working' | 'dedicated'; status?: AgentStatus } = {},
  ): Promise<AgentSummary[]> {
    return flows.listAgents(await this.#call(actor), parseInput(ListFilterSchema, filter))
  }

  /**
   * One registry row, with desired and applied versions.
   *
   * @throws {@link TypeError} When the agent is unknown.
   */
  async getAgent(actor: AdminActor, agentId: string): Promise<AgentSummary> {
    return flows.getAgent(await this.#call(actor), parseAgentId(agentId))
  }

  /**
   * The agent a UUID, slug, or unique UUID prefix names.
   *
   * @throws {@link TypeError} When nothing matches, or a prefix is ambiguous (with candidates).
   */
  async resolveAgent(actor: AdminActor, ref: string): Promise<AgentSummary> {
    return flows.resolveAgent(await this.#call(actor), parseAgentRef(ref))
  }

  /**
   * Change the display name or slug; the UUID never changes.
   *
   * @throws {@link TypeError} When the agent is unknown, the change is invalid, or the slug is taken.
   */
  async renameAgent(
    actor: AdminActor,
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
  async getConfig(actor: AdminActor, agentId: string): Promise<ConfigVersion> {
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
    actor: AdminActor,
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
    actor: AdminActor,
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
    actor: AdminActor,
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
}
