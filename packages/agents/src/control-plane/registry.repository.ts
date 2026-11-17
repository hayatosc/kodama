/**
 * Data-access repository for the agent registry and MCP assignment commit fences in management D1.
 *
 * @see docs/agents.md — Registry and admission
 *
 * @module
 */
import { prepareQuery } from '../lib/reylo.ts'
import type { AgentStatus } from '../protocol.ts'
import { parseAgentRow } from './db.ts'
import type { AgentRow, ManagementDb } from './db.ts'
import { queries } from './queries/index.ts'

/** Parameters required to insert a new agent row. */
export interface InsertAgentParams {
  agentId: string
  objectName: string
  kind: AgentRow['kind']
  displayName: string
  slug: string | null
  status: AgentStatus
  currentVersion: number
  createdAt: number
  updatedAt: number
}

/** Parameters required to record an MCP assignment commit fence. */
export interface McpFenceAssignmentParams {
  operationId: string
  agentId: string
  toolId: string
  serverId: string
  serverRevision: number
  digest: string
  credentialId: string
  createdAt: number
}

/** Fetch one agent registry row by ID, or `undefined` when absent. */
export async function findAgentById(
  db: ManagementDb,
  agentId: string,
): Promise<AgentRow | undefined> {
  const row = await queries.getAgentById.run(db, { agentId })
  return row === null ? undefined : parseAgentRow(row)
}

/** Fetch one agent registry row by Durable Object name, or `undefined` when absent. */
export async function findAgentByObjectName(
  db: ManagementDb,
  objectName: string,
): Promise<AgentRow | undefined> {
  const row = await queries.getAgentByObjectName.run(db, { objectName })
  return row === null ? undefined : parseAgentRow(row)
}

/** Fetch one agent registry row by slug, or `undefined` when absent. */
export async function findAgentBySlug(
  db: ManagementDb,
  slug: string,
): Promise<AgentRow | undefined> {
  const row = await queries.getAgentBySlug.run(db, { slug })
  return row === null ? undefined : parseAgentRow(row)
}

/** List agents whose UUID starts with `prefixPattern`, bounded by `limit`. */
export async function listAgentsByPrefix(
  db: ManagementDb,
  prefixPattern: string,
  limit: number,
): Promise<AgentRow[]> {
  const rows = await queries.listAgentsByPrefix.run(db, { prefixPattern, limit })
  return rows.map(parseAgentRow)
}

/** List active working agent projection rows for discovery, bounded after `cursor`. */
export async function listDiscoverAgentRows(db: ManagementDb, cursor: string | null) {
  return queries.listDiscoverAgents.run(db, { cursor })
}

/** List registry rows filtered optionally by kind and status. */
export async function listRegistryAgents(
  db: ManagementDb,
  filter: { kind?: AgentRow['kind']; status?: AgentStatus },
): Promise<AgentRow[]> {
  const rows = await queries.listAgents.run(db, {
    kind: filter.kind ?? null,
    status: filter.status ?? null,
  })
  return rows.map(parseAgentRow)
}

/** List agents ordered after `cursor` for usage sweeps. */
export async function listAgentsAfterCursor(db: ManagementDb, cursor: string, limit: number) {
  return queries.listAgentsAfterCursor.run(db, { cursor, limit })
}

/** List wrapped-around agents up to `cursor` for usage sweeps. */
export async function listAgentsWrap(db: ManagementDb, cursor: string, limit: number) {
  return queries.listAgentsWrap.run(db, { cursor, limit })
}

/** List agents needing reconciliation ordered after `cursor`. */
export async function listAgentsForReconcile(
  db: ManagementDb,
  cursor: string,
  limit: number,
): Promise<AgentRow[]> {
  const rows = await queries.listAgentsForReconcile.run(db, { cursor, limit })
  return rows.map(parseAgentRow)
}

/** List wrapped-around agents needing reconciliation up to `cursor`. */
export async function listAgentsForReconcileWrap(
  db: ManagementDb,
  cursor: string,
  limit: number,
): Promise<AgentRow[]> {
  const rows = await queries.listAgentsForReconcileWrap.run(db, { cursor, limit })
  return rows.map(parseAgentRow)
}

/** Prepare an insert statement for a new agent row. */
export function insertAgentStatement(
  db: ManagementDb,
  params: InsertAgentParams,
): D1PreparedStatement {
  return prepareQuery(db, queries.insertAgent, params)
}

/** Prepare a statement transitioning a provisioning agent to active. */
export function activateAgentStatement(
  db: ManagementDb,
  params: { status: AgentStatus; updatedAt: number; agentId: string },
): D1PreparedStatement {
  return prepareQuery(db, queries.updateActivateAgent, params)
}

/** Prepare a statement updating an agent's display name and/or slug. */
export function renameAgentStatement(
  db: ManagementDb,
  params: {
    displayName: string | null
    updateSlug: number
    slug: string | null
    updatedAt: number
    agentId: string
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.updateRenameAgent, params)
}

/** Prepare a statement advancing an agent's desired configuration version. */
export function advanceDesiredVersionStatement(
  db: ManagementDb,
  params: { version: number; updatedAt: number; agentId: string; expected: number },
): D1PreparedStatement {
  return prepareQuery(db, queries.updateAdvanceDesiredVersion, params)
}

/** Record that the agent's object applied `version`; never moves backwards or past desired. */
export async function reportAppliedVersion(
  db: ManagementDb,
  agentId: string,
  version: number,
): Promise<void> {
  await queries.updateReportAppliedVersion.run(db, {
    version,
    agentId,
    appliedCeiling: version,
    desiredFloor: version,
  })
}

/** Prepare a statement committing an MCP tool assignment fence inside a config write batch. */
export function commitMcpFenceAgentAssignmentStatement(
  db: ManagementDb,
  params: McpFenceAssignmentParams,
): D1PreparedStatement {
  return prepareQuery(db, queries.insertCommitMcpFenceAgentAssignment, params)
}
