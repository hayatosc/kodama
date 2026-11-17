/**
 * Data-access repository for chat-originated MCP registration requests, proposals, and host intents
 * in management D1.
 *
 * @module
 */
import type { ManagementDb } from '../../control-plane/db.ts'
import { parseEnum, prepareQuery } from '../../lib/reylo.ts'
import { queries } from './queries/index.ts'

/** Allowed lifecycle states of a chat-originated MCP registration request. */
export const MCP_REQUEST_STATUSES = [
  'awaiting_endpoint',
  'registered_unverified',
  'awaiting_owner_auth',
  'ready_for_discovery',
  'discovered',
  'failed',
] as const

/** Narrowed row shape from `mcp_requests`. */
export interface McpRequestRow {
  requestId: string
  sourceAgentId: string
  conversationId: string
  entryId: number
  submissionId: string
  serverId: string | null
  serverRevision: number | null
  credentialId: string | null
  status: (typeof MCP_REQUEST_STATUSES)[number]
  name: string
  notifiedAt: number | null
  expiresAt: number
  createdAt: number
}

/** Narrow a raw SQL `mcp_requests` row into an {@link McpRequestRow}. */
export function parseMcpRequestRow(row: {
  requestId: string
  sourceAgentId: string
  conversationId: string
  entryId: number
  submissionId: string
  serverId: string | null
  serverRevision: number | null
  credentialId: string | null
  status: string
  name: string
  notifiedAt: number | null
  expiresAt: number
  createdAt: number
}): McpRequestRow {
  return {
    ...row,
    status: parseEnum(MCP_REQUEST_STATUSES, row.status, 'mcp request status'),
  }
}

/** Fetch an MCP registration request by ID, or `undefined`. */
export async function findMcpRequestById(
  db: ManagementDb,
  requestId: string,
): Promise<McpRequestRow | undefined> {
  const row = await queries.getMcpRequestById.run(db, { requestId })
  return row === null ? undefined : parseMcpRequestRow(row)
}

/** Fetch an MCP registration request scoped to its source `agentId`. */
export async function findMcpRequestBySourceId(
  db: ManagementDb,
  requestId: string,
  agentId: string,
): Promise<McpRequestRow | undefined> {
  const row = await queries.getMcpRequestBySourceId.run(db, { requestId, agentId })
  return row === null ? undefined : parseMcpRequestRow(row)
}

/** Fetch the latest created MCP registration request for a conversation/server pair. */
export async function findMcpRequestLatestCreated(
  db: ManagementDb,
  sourceAgentId: string,
  conversationId: string,
  serverId: string | null,
): Promise<McpRequestRow | undefined> {
  const row = await queries.getMcpRequestLatestCreated.run(db, {
    sourceAgentId,
    conversationId,
    serverId,
  })
  return row === null ? undefined : parseMcpRequestRow(row)
}

/** Fetch the latest MCP registration request ordered by source entry ID. */
export async function findMcpRequestLatestEntry(
  db: ManagementDb,
  sourceAgentId: string,
  conversationId: string,
  serverId: string | null,
): Promise<McpRequestRow | undefined> {
  const row = await queries.getMcpRequestLatestEntry.run(db, {
    sourceAgentId,
    conversationId,
    serverId,
  })
  return row === null ? undefined : parseMcpRequestRow(row)
}

/** Prepare an insert statement for a chat-originated MCP registration request. */
export function insertMcpRequestStatement(
  db: ManagementDb,
  params: {
    requestId: string
    sourceAgentId: string
    conversationId: string
    entryId: number
    submissionId: string
    serverId: string | null
    serverRevision: number | null
    credentialId: string | null
    status: string
    name: string
    notifiedAt: number | null
    expiresAt: number
    createdAt: number
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.insertMcpRequest, params)
}

/** Mark an MCP registration request ready for discovery with `credentialId`. */
export async function updateMcpRequestReady(
  db: ManagementDb,
  credentialId: string,
  requestId: string,
): Promise<void> {
  await queries.updateMcpRequestReady.run(db, { credentialId, requestId })
}

/** Mark an MCP registration request discovered. */
export async function updateMcpRequestDiscovered(
  db: ManagementDb,
  requestId: string,
): Promise<void> {
  await queries.updateMcpRequestDiscovered.run(db, { requestId })
}

/** Advance a registration request bound to an operator input entry to `awaiting_owner_auth`. */
export async function updateMcpRequestAwaitingOwnerAuth(
  db: ManagementDb,
  sourceAgentId: string,
  entryId: number,
  conversationId: string,
): Promise<void> {
  await queries.updateMcpRequestAwaitingOwnerAuth.run(db, {
    sourceAgentId,
    entryId,
    conversationId,
  })
}

/** List MCP requests paired with terminal OAuth transactions awaiting recovery. */
export async function listTerminalMcpRequests(db: ManagementDb) {
  return queries.listTerminalMcpRequests.run(db)
}

/** Recover an MCP request whose OAuth transaction completed. */
export async function updateMcpRequestRecoverReady(
  db: ManagementDb,
  credentialId: string,
  requestId: string,
): Promise<void> {
  await queries.updateMcpRequestRecoverReady.run(db, { credentialId, requestId })
}

/** Recover an MCP request whose OAuth transaction failed or mismatched. */
export async function updateMcpRequestRecoverFailed(
  db: ManagementDb,
  requestId: string,
): Promise<void> {
  await queries.updateMcpRequestRecoverFailed.run(db, { requestId })
}

/** Mark expired in-flight MCP registration requests failed as of `now`. */
export async function failExpiredMcpRequests(db: ManagementDb, now: number): Promise<void> {
  await queries.updateFailExpiredMcpRequests.run(db, { now })
}

/** List discovered or failed MCP registration requests not yet delivered to their source agent. */
export async function listUnnotifiedMcpRequests(db: ManagementDb) {
  return queries.listUnnotifiedMcpRequests.run(db)
}

/** Record notification delivery time on an MCP registration request. */
export async function markMcpRequestNotified(
  db: ManagementDb,
  requestId: string,
  now: number,
): Promise<void> {
  await queries.updateMarkMcpRequestNotified.run(db, { now, requestId })
}

/** Check whether a completed OAuth transaction matches the given registration request and credential. */
export async function findMcpCompletedOauthForRequest(
  db: ManagementDb,
  params: { requestId: string; serverId: string; serverRevision: number; credentialId: string },
) {
  return (await queries.getMcpCompletedOauthForRequest.run(db, params)) ?? undefined
}

/** Fetch a selection proposal by `proposalId`. */
export async function findMcpProposal(db: ManagementDb, proposalId: string) {
  return (await queries.getMcpProposal.run(db, { proposalId })) ?? undefined
}

/** Persist a new host-generated MCP tool selection proposal. */
export async function insertMcpProposal(
  db: ManagementDb,
  params: {
    proposalId: string
    requestId: string
    sourceAgentId: string
    conversationId: string
    serverId: string
    serverRevision: number
    catalogDigest: string
    credentialId: string
    agentId: string
    toolIdsJson: string
    expiresAt: number
  },
): Promise<void> {
  await queries.insertMcpProposal.run(db, params)
}

/** Prepare a commit fence statement consuming a selection proposal. */
export function commitMcpProposalStatement(
  db: ManagementDb,
  params: {
    operationId: string
    proposalId: string
    sourceAgentId: string
    conversationId: string
    createdAt: number
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.insertCommitMcpProposal, params)
}

/** Fetch a recorded MCP host intent by `intentId`. */
export async function findMcpIntent(db: ManagementDb, intentId: string) {
  return (await queries.getMcpIntent.run(db, { intentId })) ?? undefined
}

/** Idempotently insert a host-observed MCP intent row. */
export async function insertMcpIntentIgnore(
  db: ManagementDb,
  params: {
    intentId: string
    sourceAgentId: string
    conversationId: string
    entryId: number
    submissionId: string
    createdAt: number
    expiresAt: number
    instructionJson: string
  },
): Promise<void> {
  await queries.insertMcpIntentIgnore.run(db, params)
}

/** Prepare an intent commit fence statement. */
export function commitMcpIntentStatement(
  db: ManagementDb,
  params: {
    operationId: string
    intentId: string
    sourceAgentId: string
    conversationId: string
    submissionId: string
    instructionJson: string
    now: number
    createdAt: number
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.insertCommitMcpIntent, params)
}

/** Prepare a statement marking an MCP intent consumed. */
export function consumeMcpIntentStatement(
  db: ManagementDb,
  intentId: string,
  now: number,
): D1PreparedStatement {
  return prepareQuery(db, queries.updateConsumeMcpIntent, { intentId, now })
}
