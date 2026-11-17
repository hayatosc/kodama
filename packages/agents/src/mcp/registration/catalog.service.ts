/**
 * Installation-wide MCP catalog service and atomic mutation fences.
 * Registration never grants an agent or releases a credential.
 *
 * @module
 */
import * as v from 'valibot'
import { auditStatement } from '../../control-plane/audit.service.ts'
import type { ManagementDb } from '../../control-plane/db.ts'
import { findAgentById } from '../../control-plane/registry.repository.ts'
import { versionRow } from '../../control-plane/versions.service.ts'
import { runBatch } from '../../lib/reylo.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import type { McpToolSelection } from '../../protocol.ts'
import {
  findMcpAssignment,
  findMcpDefinition,
  findMcpGrantedCredential,
  findMcpServerByEndpoint,
  findMcpServerById,
  findMcpToolById,
  insertMcpCommitStatement,
  insertMcpServerStatement,
  listMcpServers,
  listMcpServersByName,
  listMcpToolsPresent,
} from './catalog.repository.ts'
import { consumeMcpIntent, mcpIntentAudit } from './intents.service.ts'
import type { McpIntent } from './intents.service.ts'
import { insertMcpRequestStatement } from './requests.repository.ts'

/** Prepare an unconditional MCP commit fence statement for an atomic batch. */
export function mcpCommit(db: ManagementDb, operationId: string): D1PreparedStatement {
  return insertMcpCommitStatement(db, operationId, Date.now())
}

/** Resolve a shared registration by ID without creating objects or guessing endpoints. */
export async function mcpServer(db: ManagementDb, serverId: string) {
  const server = await findMcpServerById(db, serverId)
  if (!server) throw new Error('mcp_server_not_found')
  return server
}

/** The common catalog contains no credentials or authentication transaction state. */
export async function listMcpCatalog(db: ManagementDb) {
  return listMcpServers(db)
}

/** Name-only resolution never searches the network or chooses between ambiguous matches. */
export async function resolveMcpName(db: ManagementDb, name: string) {
  const rows = await listMcpServersByName(db, name)
  return rows.length === 1 ? rows[0] : undefined
}

/** Reuse the exact endpoint globally. A new registration remains disabled until vetted. */
export async function registerMcpCatalog(
  db: ManagementDb,
  name: string,
  endpoint: string,
  now: number,
  intent?: McpIntent,
) {
  const previous = await findMcpServerByEndpoint(db, endpoint)
  if (
    intent &&
    (intent.instruction.operation !== 'register' ||
      intent.instruction.name !== name ||
      (intent.instruction.endpoint && intent.instruction.endpoint !== endpoint))
  )
    throw new Error('mcp_intent_mismatch')
  const serverId = previous?.serverId ?? uuidv7(now)
  const request = intent
    ? insertMcpRequestStatement(db, {
        requestId: uuidv7(now),
        sourceAgentId: intent.sourceAgentId,
        conversationId: intent.conversationId,
        entryId: intent.entryId,
        submissionId: intent.submissionId,
        serverId,
        serverRevision: previous?.revision ?? 1,
        credentialId: null,
        status: 'registered_unverified',
        name,
        notifiedAt: null,
        expiresAt: intent.expiresAt,
        createdAt: now,
      })
    : undefined
  if (previous) {
    if (intent && request)
      await runBatch(db, [
        mcpCommit(db, `mcp.register.chat:${intent.intentId}`),
        ...consumeMcpIntent(db, intent),
        request,
        auditStatement(db, {
          opId: `mcp.register.chat:${intent.intentId}`,
          at: now,
          source: 'operator',
          action: 'mcp.register',
          targetKind: 'system',
          targetId: serverId,
          detail: mcpIntentAudit(intent),
        }),
      ])
    return previous
  }
  // Full random UUID material fits the 64-character model name budget with short tool IDs.
  const shortId = serverId.replaceAll('-', '').slice(12)
  await runBatch(db, [
    mcpCommit(db, `mcp.register:${serverId}`),
    ...(intent ? consumeMcpIntent(db, intent) : []),
    ...(request ? [request] : []),
    insertMcpServerStatement(db, {
      serverId,
      shortId,
      name,
      endpoint,
      createdAt: now,
      updatedAt: now,
    }),
    auditStatement(db, {
      opId: `mcp.register:${serverId}`,
      at: now,
      source: 'operator',
      action: 'mcp.register',
      targetKind: 'system',
      targetId: serverId,
      detail: { revision: 1, ...(intent ? mcpIntentAudit(intent) : { origin: 'rpc' }) },
    }),
  ])
  return mcpServer(db, serverId)
}

/** Fetch one immutable definition for an applied snapshot without network discovery. */
export async function mcpDefinition(db: ManagementDb, digest: string) {
  const row = await findMcpDefinition(db, digest)
  if (!row) throw new Error('mcp_definition_missing')
  const value: unknown = JSON.parse(row.definitionJson)
  return value
}

/** Live send-time policy. Old pinned snapshots cannot bypass revocation or changed definitions. */
export async function guardMcpSelection(
  db: ManagementDb,
  agentId: string,
  selected: McpToolSelection,
) {
  const agent = await findAgentById(db, agentId)
  if (!agent || agent.kind !== 'working' || agent.status !== 'active')
    throw new Error('mcp_agent_unavailable')
  const desired = await versionRow(db, agent.agentId, agent.currentVersion)
  if (!desired) throw new Error('mcp_tool_disabled')
  const desiredValue: unknown = JSON.parse(desired.settingsJson)
  const policy = v.parse(
    v.object({
      tools: v.array(v.string()),
      toolPolicy: v.optional(v.record(v.string(), v.string())),
    }),
    desiredValue,
  )
  if (
    !policy.tools.includes(selected.modelName) ||
    policy.toolPolicy?.[selected.modelName] === 'deny'
  )
    throw new Error('mcp_tool_disabled')
  const server = await mcpServer(db, selected.serverId)
  const tool = await findMcpToolById(db, selected.toolId)
  const assignment = await findMcpAssignment(db, agentId, selected.toolId)
  if (!tool || !tool.present || tool.rejection || tool.digest !== selected.digest)
    throw new Error('mcp_schema_changed')
  const credential = await findMcpGrantedCredential(
    db,
    agentId,
    selected.credentialId,
    selected.serverId,
  )
  if (!credential) throw new Error('mcp_assignment_revoked')
  if (
    !server.enabled ||
    server.revision !== selected.serverRevision ||
    !tool ||
    !tool.present ||
    tool.rejection ||
    tool.serverId !== selected.serverId ||
    tool.digest !== selected.digest ||
    tool.modelName !== selected.modelName ||
    tool.serverRevision !== selected.serverRevision ||
    !assignment ||
    assignment.digest !== selected.digest ||
    assignment.credentialId !== selected.credentialId ||
    assignment.serverRevision !== selected.serverRevision
  )
    throw new Error('mcp_assignment_revoked')
  return { endpoint: server.endpoint, remoteName: tool.remoteName }
}

/** Read only the current vetted definitions; descriptions remain untrusted external data. */
export async function mcpCatalogTools(db: ManagementDb, serverId: string) {
  return listMcpToolsPresent(db, serverId)
}
