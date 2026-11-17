/**
 * Data-access repository for the MCP server catalog, tool definitions, assignments, and notices in
 * management D1.
 *
 * @module
 */
import type { ManagementDb } from '../../control-plane/db.ts'
import { prepareQuery } from '../../lib/reylo.ts'
import { queries } from './queries/index.ts'

/** Prepare an unconditional MCP commit fence statement for an atomic batch. */
export function insertMcpCommitStatement(
  db: ManagementDb,
  operationId: string,
  createdAt: number,
): D1PreparedStatement {
  return prepareQuery(db, queries.insertMcpCommit, { operationId, createdAt })
}

/** Fetch an MCP server registration by ID, or `undefined`. */
export async function findMcpServerById(db: ManagementDb, serverId: string) {
  return (await queries.getMcpServerById.run(db, { serverId })) ?? undefined
}

/** Fetch an MCP server registration by exact HTTPS endpoint, or `undefined`. */
export async function findMcpServerByEndpoint(db: ManagementDb, endpoint: string) {
  return (await queries.getMcpServerByEndpoint.run(db, { endpoint })) ?? undefined
}

/** List all MCP server registrations. */
export async function listMcpServers(db: ManagementDb) {
  return queries.listMcpServers.run(db)
}

/** List MCP server registrations matching `name`. */
export async function listMcpServersByName(db: ManagementDb, name: string) {
  return queries.listMcpServersByName.run(db, { name })
}

/** Prepare a statement inserting a new MCP server registration. */
export function insertMcpServerStatement(
  db: ManagementDb,
  params: {
    serverId: string
    shortId: string
    name: string
    endpoint: string
    createdAt: number
    updatedAt: number
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.insertMcpServer, params)
}

/** Prepare a statement updating MCP server name, endpoint, enabled status, and revision. */
export function updateMcpServerStatement(
  db: ManagementDb,
  params: {
    name: string
    endpoint: string
    enabled: boolean
    revision: number
    catalogDigest: string | null
    catalogVersion: number
    updatedAt: number
    serverId: string
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.updateMcpServer, params)
}

/** Prepare a server state commit fence statement. */
export function commitMcpServerStateStatement(
  db: ManagementDb,
  params: {
    operationId: string
    serverId: string
    revision: number
    catalogVersion: number
    createdAt: number
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.insertCommitMcpServerState, params)
}

/** Prepare a server revision commit fence statement. */
export function commitMcpServerRevisionStatement(
  db: ManagementDb,
  params: { operationId: string; serverId: string; revision: number; createdAt: number },
): D1PreparedStatement {
  return prepareQuery(db, queries.insertCommitMcpServerRevision, params)
}

/** Prepare a statement disabling an MCP server and advancing its revision. */
export function disableMcpServerStatement(
  db: ManagementDb,
  params: { nextRevision: number; updatedAt: number; serverId: string; expectedRevision: number },
): D1PreparedStatement {
  return prepareQuery(db, queries.updateDisableMcpServer, params)
}

/** Prepare a statement publishing a validated MCP tool catalog snapshot. */
export function publishMcpServerStatement(
  db: ManagementDb,
  params: {
    catalogDigest: string
    catalogVersion: number
    inspectedAt: number
    stale: boolean
    updatedAt: number
    serverId: string
    revision: number
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.updatePublishMcpServer, params)
}

/** Record an inspection error code on the current server revision and catalog version. */
export async function recordMcpInspectionError(
  db: ManagementDb,
  params: { inspectionError: string; serverId: string; revision: number; catalogVersion: number },
): Promise<void> {
  await queries.updateRecordMcpInspectionError.run(db, params)
}

/** Fetch one immutable MCP tool definition by digest. */
export async function findMcpDefinition(db: ManagementDb, digest: string) {
  return (await queries.getMcpDefinition.run(db, { digest })) ?? undefined
}

/** Prepare an idempotent insert for a vetted immutable MCP tool definition. */
export function insertMcpDefinitionIgnoreStatement(
  db: ManagementDb,
  digest: string,
  definitionJson: string,
): D1PreparedStatement {
  return prepareQuery(db, queries.insertMcpDefinitionIgnore, { digest, definitionJson })
}

/** Fetch one MCP tool row by `toolId`. */
export async function findMcpToolById(db: ManagementDb, toolId: string) {
  return (await queries.getMcpToolById.run(db, { toolId })) ?? undefined
}

/** List currently present vetted MCP tool definitions for `serverId`. */
export async function listMcpToolsPresent(db: ManagementDb, serverId: string) {
  return queries.listMcpToolsPresent.run(db, { serverId })
}

/** List all recorded MCP tools for `serverId` regardless of current presence. */
export async function listMcpToolsByServer(db: ManagementDb, serverId: string) {
  return queries.listMcpToolsByServer.run(db, { serverId })
}

/** Prepare a statement marking all previously discovered tools for `serverId` absent. */
export function markMcpToolsAbsentStatement(
  db: ManagementDb,
  serverId: string,
): D1PreparedStatement {
  return prepareQuery(db, queries.updateMarkMcpToolsAbsent, { serverId })
}

/** Prepare an upsert statement for one inspected MCP tool. */
export function upsertMcpToolStatement(
  db: ManagementDb,
  params: {
    toolId: string
    serverId: string
    remoteName: string
    modelName: string
    serverRevision: number
    digest: string
    definitionJson: string
    rejection: string | null
    present: boolean
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.insertMcpToolUpsert, params)
}

/** Fetch one live MCP tool assignment for `(agentId, toolId)`. */
export async function findMcpAssignment(db: ManagementDb, agentId: string, toolId: string) {
  return (await queries.getMcpAssignment.run(db, { agentId, toolId })) ?? undefined
}

/** List agent IDs assigned to tools backed by `credentialId`. */
export async function listMcpAssignmentAgentIds(db: ManagementDb, credentialId: string) {
  return queries.listMcpAssignmentAgentIds.run(db, { credentialId })
}

/** Prepare a statement deleting an agent's assignments for `serverId`. */
export function deleteMcpAssignmentsByServerStatement(
  db: ManagementDb,
  agentId: string,
  serverId: string,
): D1PreparedStatement {
  return prepareQuery(db, queries.deleteMcpAssignmentsByServer, { agentId, serverId })
}

/** Prepare a statement inserting an active MCP tool assignment. */
export function insertMcpAssignmentStatement(
  db: ManagementDb,
  params: {
    agentId: string
    toolId: string
    serverId: string
    serverRevision: number
    digest: string
    credentialId: string
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.insertMcpAssignment, params)
}

/** Check whether `agentId` holds an active grant for MCP `credentialId` on `serverId`. */
export async function findMcpGrantedCredential(
  db: ManagementDb,
  agentId: string,
  credentialId: string,
  serverId: string,
) {
  return (
    (await queries.getMcpGrantedCredential.run(db, { agentId, credentialId, serverId })) ??
    undefined
  )
}

/** Fetch a working agent row by `agentId`, or `undefined`. */
export async function findWorkingAgent(db: ManagementDb, agentId: string) {
  return (await queries.getWorkingAgent.run(db, { agentId })) ?? undefined
}

/** Fetch an active working agent row by `agentId`, or `undefined`. */
export async function findActiveWorkingAgent(db: ManagementDb, agentId: string) {
  return (await queries.getActiveWorkingAgent.run(db, { agentId })) ?? undefined
}

/** Prepare an agent version commit fence statement for MCP unassignment. */
export function commitMcpAgentVersionStatement(
  db: ManagementDb,
  params: { operationId: string; agentId: string; currentVersion: number; createdAt: number },
): D1PreparedStatement {
  return prepareQuery(db, queries.insertCommitMcpAgentVersion, params)
}

/** Prepare an assignment commit fence statement. */
export function commitMcpAssignStatement(
  db: ManagementDb,
  params: {
    operationId: string
    serverId: string
    revision: number
    catalogVersion: number
    agentId: string
    currentVersion: number
    credentialId: string
    createdAt: number
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.insertCommitMcpAssign, params)
}

/** Mark an MCP server catalog revision as stale for notification purposes. */
export async function markMcpServerStale(
  db: ManagementDb,
  serverId: string,
  revision: number,
): Promise<void> {
  await queries.updateMarkMcpServerStale.run(db, { serverId, revision })
}

/** List current catalog/credential condition rows affecting `(agentId, serverId)`. */
export async function listMcpCatalogNotices(db: ManagementDb, agentId: string, serverId: string) {
  return queries.listMcpCatalogNotices.run(db, { agentId, serverId })
}

/** Fetch an unavailable credential notice row for `(agentId, credentialId)`. */
export async function findMcpCredentialNotice(
  db: ManagementDb,
  agentId: string,
  credentialId: string,
) {
  return (await queries.getMcpCredentialNotice.run(db, { agentId, credentialId })) ?? undefined
}

/** List agent configs still referencing revoked MCP credentials. */
export async function listMcpRevocationRecipients(db: ManagementDb) {
  return queries.listMcpRevocationRecipients.run(db)
}

/** List agents holding assignments on `serverId` (or all servers when `null`). */
export async function listMcpNoticeRecipients(db: ManagementDb, serverId: string | null) {
  return queries.listMcpNoticeRecipients.run(db, { serverId })
}
