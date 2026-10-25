/**
 * The management flows of the agent registry and configuration versions. Each takes the call
 * `AgentService` authorized and the already-validated input.
 *
 * @see docs/agents.md — Management RPC
 *
 * @module
 */
import { and, eq } from 'drizzle-orm'
import * as v from 'valibot'
import { VersionSchema } from '../../validation.ts'
import type { Models } from '@earendil-works/pi-ai/models'
import { agentConfigVersions, agentMembers, agents } from '../../../drizzle/management/schema.ts'
import { initialGrantStatements, referenceStatements } from '../../credentials/references.ts'
import { validateCredentialRefs } from '../../credentials/validation.ts'
import { defaultAgentSettings, parseSettings } from '../../configuration/index.ts'
import { auditByOpId, auditStatement } from '../audit.ts'
import type { AgentRow, ManagementDb, PrincipalRow, VersionRow } from '../db.ts'
import { agentRow, listAgentRows, resolveAgentRef, summaryOf } from '../registry.ts'
import { reportApplied, versionRow, versionRows, writeVersionStatements } from '../versions.ts'
import { SETTINGS_SCHEMA_VERSION } from '../../configuration/index.ts'
import type { MemoryModelEnv } from '../../system-agents/memory/config.ts'
import type { AgentEnv } from '../../env.ts'
import { errorText, isConstraintError } from '../../lib/errors.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import type {
  AgentSettings,
  AgentStatus,
  AgentSummary,
  ApplyResult,
  ConfigVersion,
  ConfigWriteResult,
  CreateAgentRequest,
  RenameAgentRequest,
  RollbackConfigRequest,
  UpdateConfigRequest,
} from '../../protocol.ts'

/** The bindings and variables the management flows use. */
export type ManagementEnv = Pick<AgentEnv, 'AGENTS' | 'MANAGEMENT_DB'> & MemoryModelEnv

/** What every management flow receives. */
export interface ManagementCall {
  env: ManagementEnv
  db: ManagementDb
  models: Models
  /** The authorized caller; `null` for the system (the seed and reconciliation). */
  principal: PrincipalRow | null
  now: number
}

/** The acting principal's ID, or `null` for the system. */
function actorId(call: ManagementCall): string | null {
  return call.principal?.principalId ?? null
}

/** A stored version as `AgentService` returns it. */
function configVersionOf(models: Models, row: VersionRow): ConfigVersion {
  return {
    version: row.version,
    settings: parseSettings(models, JSON.parse(row.settingsJson)),
    ...(row.authorId === null ? {} : { authorId: row.authorId }),
    ...(row.comment === null ? {} : { comment: row.comment }),
    createdAt: row.createdAt,
  }
}

/**
 * The settings of one stored version.
 *
 * @throws {@link TypeError} When the agent has no such version.
 */
async function storedSettings(call: ManagementCall, agentId: string, version: number) {
  const row = await versionRow(call.db, agentId, version)
  if (row === undefined) throw new TypeError(`Unknown version ${version} of agent ${agentId}`)
  return configVersionOf(call.models, row).settings
}

/**
 * Push one version to the agent's object and record what it applied. The registry write is the
 * commitment; a lost or failed push is applied later, when the object opens or at reconciliation.
 */
export async function pushVersion(
  env: ManagementEnv,
  db: ManagementDb,
  row: Pick<AgentRow, 'agentId' | 'objectName' | 'appliedVersion'>,
  version: number,
  settings: AgentSettings,
): Promise<ApplyResult> {
  let apply: ApplyResult
  try {
    apply = await env.AGENTS.getByName(row.objectName).applyConfig({
      agentId: row.agentId,
      version,
      settings,
    })
  } catch (error) {
    console.error(`Pushing version ${version} to agent ${row.agentId} failed`, error)
    return { state: 'failed', appliedVersion: row.appliedVersion }
  }
  if (apply.appliedVersion > row.appliedVersion) {
    await reportApplied(db, row.agentId, apply.appliedVersion)
  }
  return apply
}

/**
 * Push an agent's desired version if its object has not applied it yet.
 *
 * @throws {@link TypeError} When the agent is unknown.
 */
export async function pushDesired(call: ManagementCall, agentId: string): Promise<ApplyResult> {
  const row = await agentRow(call.db, agentId)
  if (row.appliedVersion >= row.currentVersion) {
    return { state: 'stale', appliedVersion: row.appliedVersion }
  }
  const settings = await storedSettings(call, agentId, row.currentVersion)
  return pushVersion(call.env, call.db, row, row.currentVersion, settings)
}

/**
 * Push the first version to a provisioning agent and activate it; repeating it is harmless.
 *
 * @returns The agent's row after the attempt; still `provisioning` when the push did not apply.
 */
export async function finishProvisioning(call: ManagementCall, agentId: string): Promise<AgentRow> {
  const row = await agentRow(call.db, agentId)
  if (row.status !== 'provisioning') return row
  const settings = await storedSettings(call, agentId, row.currentVersion)
  const apply = await pushVersion(call.env, call.db, row, row.currentVersion, settings)
  if (apply.appliedVersion < row.currentVersion) return agentRow(call.db, agentId)
  const active: AgentStatus = 'active'
  // The object's copy first: the registry is the source, and a stop here is finished next time.
  await call.env.AGENTS.getByName(row.objectName).setStatus(active)
  await call.db.batch([
    call.db
      .update(agents)
      .set({ status: active, updatedAt: call.now })
      .where(and(eq(agents.agentId, agentId), eq(agents.status, 'provisioning'))),
    auditStatement(call.db, {
      opId: `agent.activate:${agentId}`,
      at: call.now,
      actorId: actorId(call),
      action: 'agent.activate',
      targetKind: 'agent',
      targetId: agentId,
    }).onConflictDoNothing(),
  ])
  return agentRow(call.db, agentId)
}

/**
 * Create a working agent: a new UUID v7, then the registry row (`provisioning`), version 1, the
 * caller's owner membership, and the audit row in one batch; then initialize the object and
 * activate it. The system (the seed) creates agents with no owner.
 *
 * @remarks
 * Reusing `requestId` returns the agent the first attempt created. A stop after the batch leaves the
 * agent `provisioning`, and reconciliation finishes it.
 *
 * @throws {@link TypeError} When the settings are invalid or the slug is taken.
 */
export async function createAgent(
  call: ManagementCall,
  request: Omit<CreateAgentRequest, 'settings'> & { settings?: unknown },
): Promise<AgentSummary> {
  const creator = actorId(call)
  const opId = `agent.create:${creator ?? 'system'}:${request.requestId}`
  const earlier = await auditByOpId(call.db, opId)
  if (earlier !== undefined) return summaryOf(await finishProvisioning(call, earlier.targetId))
  const settings =
    request.settings === undefined
      ? defaultAgentSettings(call.env)
      : parseSettings(call.models, request.settings)
  if (settings.credentials && call.principal && call.principal.systemRole !== 'owner') {
    throw new Error('forbidden: credential assignment requires an installation owner')
  }
  await validateCredentialRefs(call.db, settings)
  const agentId = uuidv7(call.now)
  const membership =
    creator === null
      ? []
      : [call.db.insert(agentMembers).values({ agentId, principalId: creator, role: 'owner' })]
  try {
    await call.db.batch([
      call.db.insert(agents).values({
        agentId,
        objectName: agentId,
        kind: 'working',
        displayName: request.displayName,
        slug: request.slug ?? null,
        status: 'provisioning',
        currentVersion: 1,
        ownerId: creator,
        createdAt: call.now,
        updatedAt: call.now,
      }),
      call.db.insert(agentConfigVersions).values({
        agentId,
        version: 1,
        settingsJson: JSON.stringify(settings),
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        authorId: creator,
        comment: 'create',
        createdAt: call.now,
      }),
      ...membership,
      ...initialGrantStatements(call.db, agentId, settings, call.now),
      ...referenceStatements(call.db, agentId, 1, settings),
      auditStatement(call.db, {
        opId,
        at: call.now,
        actorId: creator,
        action: 'agent.create',
        targetKind: 'agent',
        targetId: agentId,
        detail: { displayName: request.displayName, slug: request.slug },
      }),
    ])
  } catch (error) {
    if (!isConstraintError(error)) throw error
    const replay = await auditByOpId(call.db, opId)
    if (replay !== undefined) return summaryOf(await finishProvisioning(call, replay.targetId))
    if (/agents\.slug/.test(errorText(error))) {
      throw new TypeError(`slug is taken: ${request.slug}`)
    }
    throw error
  }
  return summaryOf(await finishProvisioning(call, agentId))
}

/** Registry rows, newest first. */
export async function listAgents(
  call: ManagementCall,
  filter: { kind?: AgentRow['kind']; status?: AgentStatus },
): Promise<AgentSummary[]> {
  return (await listAgentRows(call.db, filter)).map(summaryOf)
}

/**
 * One registry row.
 *
 * @throws {@link TypeError} When the registry has no such agent.
 */
export async function getAgent(call: ManagementCall, agentId: string): Promise<AgentSummary> {
  return summaryOf(await agentRow(call.db, agentId))
}

/**
 * The registry row a person named: a UUID, a slug, or a unique UUID prefix.
 *
 * @throws {@link TypeError} When nothing matches, or a prefix is ambiguous.
 */
export async function resolveAgent(call: ManagementCall, ref: string): Promise<AgentSummary> {
  return summaryOf(await resolveAgentRef(call.db, ref))
}

/**
 * Change the display name or slug. The agent's ID, object, memory, and history are untouched, and
 * no version is written.
 *
 * @throws {@link TypeError} When the agent is unknown or the slug is taken.
 */
export async function renameAgent(
  call: ManagementCall,
  agentId: string,
  change: RenameAgentRequest,
): Promise<AgentSummary> {
  await agentRow(call.db, agentId)
  const set = {
    ...(change.displayName === undefined ? {} : { displayName: change.displayName }),
    ...(change.slug === undefined ? {} : { slug: change.slug }),
    updatedAt: call.now,
  }
  try {
    await call.db.batch([
      call.db.update(agents).set(set).where(eq(agents.agentId, agentId)),
      auditStatement(call.db, {
        opId: `agent.rename:${agentId}:${uuidv7(call.now)}`,
        at: call.now,
        actorId: actorId(call),
        action: 'agent.rename',
        targetKind: 'agent',
        targetId: agentId,
        detail: { ...change },
      }),
    ])
  } catch (error) {
    if (isConstraintError(error) && /agents\.slug/.test(errorText(error))) {
      throw new TypeError(`slug is taken: ${change.slug}`)
    }
    throw error
  }
  return getAgent(call, agentId)
}

/** The error of a write based on a version that is no longer the newest. */
function versionConflict(agentId: string, expected: number): Error {
  return new Error(`version_conflict: agent ${agentId} is no longer at version ${expected}`)
}

/**
 * Write `settings` as version `expected + 1` and push it. One batch writes the version, the
 * desired version, and the audit row; of two writers from the same version, exactly one succeeds.
 *
 * @throws {@link TypeError} When the agent is unknown.
 * @throws {@link Error} Starting `version_conflict:`, when `expected` is not the newest version.
 */
async function writeVersion(
  call: ManagementCall,
  agentId: string,
  write: {
    opId: string
    expected: number
    settings: AgentSettings
    comment?: string
    rollbackOf?: number
  },
): Promise<ConfigWriteResult> {
  const replayed = async (): Promise<ConfigWriteResult | undefined> => {
    const audit = await auditByOpId(call.db, write.opId)
    if (audit === undefined) return undefined
    const { version } = v.parse(v.object({ version: VersionSchema }), JSON.parse(audit.detailJson))
    if (version !== write.expected + 1) throw versionConflict(agentId, write.expected)
    const row = await agentRow(call.db, agentId)
    const settings = await storedSettings(call, agentId, version)
    return { version, apply: await pushVersion(call.env, call.db, row, version, settings) }
  }
  const earlier = await replayed()
  if (earlier !== undefined) return earlier
  const row = await agentRow(call.db, agentId)
  if (row.currentVersion !== write.expected) throw versionConflict(agentId, write.expected)
  await validateCredentialRefs(call.db, write.settings, agentId)
  const detail = {
    ...(write.comment === undefined ? {} : { comment: write.comment }),
    ...(write.rollbackOf === undefined ? {} : { rollbackOf: write.rollbackOf }),
  }
  try {
    await call.db.batch(
      writeVersionStatements(
        call.db,
        { actorId: actorId(call), now: call.now, opId: write.opId },
        agentId,
        write.expected,
        write.settings,
        detail,
      ),
    )
  } catch (error) {
    if (!isConstraintError(error)) throw error
    const replay = await replayed()
    if (replay !== undefined) return replay
    throw versionConflict(agentId, write.expected)
  }
  const version = write.expected + 1
  return { version, apply: await pushVersion(call.env, call.db, row, version, write.settings) }
}

/**
 * Write a new configuration version on top of `expectedVersion` and push it to the agent.
 *
 * @throws {@link TypeError} When the agent is unknown or the settings are invalid.
 * @throws {@link Error} Starting `version_conflict:`, when another version was written first.
 */
export function updateConfig(
  call: ManagementCall,
  agentId: string,
  request: Omit<UpdateConfigRequest, 'settings'> & { settings: unknown },
): Promise<ConfigWriteResult> {
  return writeVersion(call, agentId, {
    opId: `agent.config:${agentId}:${request.requestId}`,
    expected: request.expectedVersion,
    settings: parseSettings(call.models, request.settings),
    ...(request.comment === undefined ? {} : { comment: request.comment }),
  })
}

/**
 * Write the settings of `toVersion` as a new version; versions are never changed or removed.
 *
 * @throws {@link TypeError} When the agent or `toVersion` is unknown.
 * @throws {@link Error} Starting `version_conflict:`, when another version was written first.
 */
export async function rollbackConfig(
  call: ManagementCall,
  agentId: string,
  request: RollbackConfigRequest,
): Promise<ConfigWriteResult> {
  return writeVersion(call, agentId, {
    opId: `agent.config:${agentId}:${request.requestId}`,
    expected: request.expectedVersion,
    settings: await storedSettings(call, agentId, request.toVersion),
    comment: request.comment ?? `rollback to version ${request.toVersion}`,
    rollbackOf: request.toVersion,
  })
}

/**
 * The desired version of an agent.
 *
 * @throws {@link TypeError} When the agent is unknown or has no version yet.
 */
export async function getConfig(call: ManagementCall, agentId: string): Promise<ConfigVersion> {
  const row = await agentRow(call.db, agentId)
  const stored = await versionRow(call.db, agentId, row.currentVersion)
  if (stored === undefined) throw new TypeError(`Agent ${agentId} has no configuration version`)
  return configVersionOf(call.models, stored)
}

/** Default and largest page of the version history. */
const HISTORY_PAGE = { default: 20, max: 100 }

/** An agent's versions, newest first: who wrote what, and when. */
export async function configHistory(
  call: ManagementCall,
  agentId: string,
  page: { before?: number; limit?: number },
): Promise<ConfigVersion[]> {
  await agentRow(call.db, agentId)
  const limit = Math.min(page.limit ?? HISTORY_PAGE.default, HISTORY_PAGE.max)
  const rows = await versionRows(call.db, agentId, {
    limit,
    ...(page.before === undefined ? {} : { before: page.before }),
  })
  return rows.map((row) => configVersionOf(call.models, row))
}
