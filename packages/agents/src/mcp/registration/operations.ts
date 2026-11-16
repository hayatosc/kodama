/** Validated private MCP management entry points shared by the CLI and authenticated hosts. @module */
import * as v from 'valibot'
import { auditStatement } from '../../control-plane/audit.ts'
import { parseSettings } from '../../control-plane/config.ts'
import { versionRow, writeVersionStatements } from '../../control-plane/versions.ts'
import { pushDesired } from '../../control-plane/workflows/agents.ts'
import type { ManagementCall } from '../../control-plane/workflows/agents.ts'
import deleteCredentialGrant from '../../credentials/sql/delete-credential-grant.sql'
import { prepareQuery, runBatch } from '../../lib/reylo.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import { mcpUiOrigin } from '../authorization/oauth-http.ts'
import { disconnectMcp } from '../authorization/refresh.ts'
import { putMcpBearer } from '../authorization/vault.ts'
import { mcpEndpoint } from '../connection/transport.ts'
import { listMcpCatalog, mcpCatalogTools, mcpServer, registerMcpCatalog } from './catalog.ts'
import { assignMcp, discoverMcp, notifyMcpAssignments } from './servers.ts'
import commitMcpAgentVersion from './sql/commit-mcp-agent-version.sql'
import commitMcpServerState from './sql/commit-mcp-server-state.sql'
import deleteMcpAssignmentsByServer from './sql/delete-mcp-assignments-by-server.sql'
import selectMcpAssignmentAgentIds from './sql/select-mcp-assignment-agent-ids.sql'
import selectWorkingAgent from './sql/select-working-agent.sql'
import updateMcpServer from './sql/update-mcp-server.sql'

const id = v.pipe(v.string(), v.uuid())
const name = v.pipe(v.string(), v.minLength(1), v.maxLength(128))
const endpoint = v.pipe(v.string(), v.transform(mcpEndpoint))
const requestSchema = v.variant('operation', [
  v.strictObject({ operation: v.literal('add'), name, endpoint }),
  v.strictObject({ operation: v.literal('list') }),
  v.strictObject({ operation: v.literal('status'), serverId: id }),
  v.strictObject({ operation: v.literal('connect'), serverId: id }),
  v.strictObject({
    operation: v.literal('update'),
    serverId: id,
    name: v.optional(name),
    endpoint: v.optional(endpoint),
    enabled: v.optional(v.boolean()),
  }),
  v.strictObject({ operation: v.literal('discover'), serverId: id, credentialId: v.optional(id) }),
  v.strictObject({
    operation: v.literal('assign'),
    serverId: id,
    credentialId: id,
    agentId: id,
    toolIds: v.pipe(v.array(id), v.minLength(1), v.maxLength(100)),
    catalogDigest: v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/u)),
    readOnly: v.optional(v.boolean(), true),
  }),
  v.strictObject({ operation: v.literal('unassign'), serverId: id, agentId: id }),
  v.strictObject({
    operation: v.literal('bearer'),
    serverId: id,
    secret: v.pipe(v.string(), v.minLength(1), v.maxLength(16_384)),
  }),
  v.strictObject({ operation: v.literal('disconnect'), serverId: id, credentialId: id }),
])

/** A display-only future UI link: this does not start OAuth or create browser state. */
export function mcpConnectLink(origin: string, serverId: string) {
  const url = new URL('/auth/mcp/connect', mcpUiOrigin(origin))
  url.searchParams.set('server', serverId)
  return { status: 'awaiting_owner_auth', url: url.href }
}

/** Validate before dispatch; credentials are accepted only by private RPC or stdin, never chat. */
export async function manageMcp(
  call: ManagementCall,
  kek: string,
  origin: string,
  value: unknown,
): Promise<unknown> {
  const input = v.parse(requestSchema, value)

  switch (input.operation) {
    case 'add':
      return registerMcpCatalog(call.db, input.name, input.endpoint, call.now)
    case 'list':
      return listMcpCatalog(call.db)
    case 'status':
      return {
        server: await mcpServer(call.db, input.serverId),
        tools: await mcpCatalogTools(call.db, input.serverId),
      }
    case 'connect':
      await mcpServer(call.db, input.serverId)
      return mcpConnectLink(origin, input.serverId)
    case 'discover':
      return discoverMcp(call, kek, input.serverId, input.credentialId)
    case 'assign':
      return assignMcp(call, kek, input)
    case 'bearer':
      return putMcpBearer(call.db, kek, input.serverId, input.secret, call.now)
    case 'disconnect': {
      const recipients = await selectMcpAssignmentAgentIds.run(call.db, {
        credentialId: input.credentialId,
      })
      const result = await disconnectMcp(call.db, kek, input.serverId, input.credentialId)
      for (const recipient of recipients)
        await call.env.AGENTS.getByName(recipient.agentId).mcpCredentialNotice(input.credentialId)
      return result
    }
    case 'unassign':
      return unassignMcp(call, input.agentId, input.serverId)
    case 'update': {
      const server = await mcpServer(call.db, input.serverId)
      const moved = input.endpoint !== undefined && input.endpoint !== server.endpoint
      if (input.enabled && (moved || !server.catalogDigest))
        throw new Error('mcp_discovery_required')
      await runBatch(call.db, [
        prepareQuery(call.db, commitMcpServerState, {
          operationId: uuidv7(),
          serverId: server.serverId,
          revision: server.revision,
          catalogVersion: server.catalogVersion,
          createdAt: Date.now(),
        }),
        prepareQuery(call.db, updateMcpServer, {
          name: input.name ?? server.name,
          endpoint: input.endpoint ?? server.endpoint,
          enabled: moved ? false : (input.enabled ?? server.enabled),
          revision: server.revision + (moved ? 1 : 0),
          catalogDigest: moved ? null : server.catalogDigest,
          catalogVersion: server.catalogVersion + 1,
          updatedAt: call.now,
          serverId: server.serverId,
        }),
        auditStatement(call.db, {
          opId: uuidv7(),
          at: call.now,
          source: call.source,
          action: 'mcp.update',
          targetKind: 'system',
          targetId: server.serverId,
          detail: { origin: 'rpc', endpointChanged: moved },
        }),
      ])
      await notifyMcpAssignments(call, server.serverId)
      return mcpServer(call.db, server.serverId)
    }
  }
}

/** Remove the live reference before push; the old applied version is already unable to send. */
export async function unassignMcp(call: ManagementCall, agentId: string, serverId: string) {
  const agent = await selectWorkingAgent.run(call.db, { agentId })
  if (!agent) throw new Error('mcp_agent_unavailable')
  const previous = await versionRow(call.db, agentId, agent.currentVersion)
  if (!previous) throw new Error('mcp_agent_config_missing')
  const settings = parseSettings(call.models, JSON.parse(previous.settingsJson))
  const removed = (settings.mcp ?? []).filter((tool) => tool.serverId === serverId)
  const names = new Set(removed.map((tool) => tool.modelName))
  const nextToolPolicy: Record<string, 'allow' | 'ask' | 'auto' | 'deny'> = {}
  for (const [toolName, policy] of Object.entries(settings.toolPolicy ?? {})) {
    if (!names.has(toolName)) nextToolPolicy[toolName] = policy
  }
  const updated = parseSettings(call.models, {
    ...settings,
    mcp: (settings.mcp ?? []).filter((tool) => tool.serverId !== serverId),
    tools: settings.tools.filter((tool) => !names.has(tool)),
    toolPolicy: Object.keys(nextToolPolicy).length > 0 ? nextToolPolicy : undefined,
  })
  const removedCredentialIds = [...new Set(removed.map((tool) => tool.credentialId))]
  await runBatch(call.db, [
    prepareQuery(call.db, commitMcpAgentVersion, {
      operationId: uuidv7(),
      agentId,
      currentVersion: agent.currentVersion,
      createdAt: Date.now(),
    }),
    ...writeVersionStatements(
      call.db,
      { source: call.source, now: call.now, opId: uuidv7() },
      agentId,
      agent.currentVersion,
      updated,
      { comment: 'Operator removed MCP assignment' },
    ),
    prepareQuery(call.db, deleteMcpAssignmentsByServer, { agentId, serverId }),
    ...removedCredentialIds.map((credentialId) =>
      prepareQuery(call.db, deleteCredentialGrant, { credentialId, agentId }),
    ),
    auditStatement(call.db, {
      opId: uuidv7(),
      at: call.now,
      source: call.source,
      action: 'mcp.unassign',
      targetKind: 'agent',
      targetId: agentId,
      detail: { serverId, origin: 'rpc' },
    }),
  ])
  return { agentId, version: agent.currentVersion + 1, apply: await pushDesired(call, agentId) }
}
