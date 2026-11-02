/** Validated private MCP management entry points shared by the CLI and authenticated hosts. @module */
import { and, eq, exists, inArray } from 'drizzle-orm'
import * as v from 'valibot'
import {
  agents,
  credentialGrants,
  mcpAssignments,
  mcpServers,
} from '../../../drizzle/management/schema.ts'
import {
  mcpCatalogTools,
  mcpCommit,
  listMcpCatalog,
  mcpServer,
  registerMcpCatalog,
} from '../mcp.ts'
import { assignMcp, discoverMcp, notifyMcpAssignments } from './mcp.ts'
import { mcpEndpoint } from '../../tools/mcp/transport.ts'
import { mcpUiOrigin } from '../../credentials/mcp-oauth-http.ts'
import { putMcpBearer } from '../../credentials/mcp-vault.ts'
import { disconnectMcp } from '../../credentials/mcp-refresh.ts'
import { auditStatement } from '../audit.ts'
import { parseSettings } from '../config.ts'
import { versionRow, writeVersionStatements } from '../versions.ts'
import { pushDesired } from './agents.ts'
import type { ManagementCall } from './agents.ts'
import { uuidv7 } from '../../lib/uuid.ts'

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
    readOnly: v.literal(true),
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
      const recipients = await call.db
        .selectDistinct({ agentId: mcpAssignments.agentId })
        .from(mcpAssignments)
        .where(eq(mcpAssignments.credentialId, input.credentialId))
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
      await call.db.batch([
        mcpCommit(
          call.db,
          uuidv7(),
          exists(
            call.db
              .select()
              .from(mcpServers)
              .where(
                and(
                  eq(mcpServers.serverId, server.serverId),
                  eq(mcpServers.revision, server.revision),
                  eq(mcpServers.catalogVersion, server.catalogVersion),
                ),
              ),
          ),
        ),
        call.db
          .update(mcpServers)
          .set({
            name: input.name ?? server.name,
            endpoint: input.endpoint ?? server.endpoint,
            enabled: moved ? false : (input.enabled ?? server.enabled),
            revision: server.revision + (moved ? 1 : 0),
            catalogDigest: moved ? null : server.catalogDigest,
            catalogVersion: server.catalogVersion + 1,
            updatedAt: call.now,
          })
          .where(eq(mcpServers.serverId, server.serverId)),
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
  const agent = await call.db
    .select()
    .from(agents)
    .where(and(eq(agents.agentId, agentId), eq(agents.kind, 'working')))
    .get()
  if (!agent) throw new Error('mcp_agent_unavailable')
  const previous = await versionRow(call.db, agentId, agent.currentVersion)
  if (!previous) throw new Error('mcp_agent_config_missing')
  const settings = parseSettings(call.models, JSON.parse(previous.settingsJson))
  const removed = (settings.mcp ?? []).filter((tool) => tool.serverId === serverId)
  const names = new Set(removed.map((tool) => tool.modelName))
  const updated = parseSettings(call.models, {
    ...settings,
    mcp: (settings.mcp ?? []).filter((tool) => tool.serverId !== serverId),
    tools: settings.tools.filter((tool) => !names.has(tool)),
  })
  await call.db.batch([
    mcpCommit(
      call.db,
      uuidv7(),
      exists(
        call.db
          .select()
          .from(agents)
          .where(and(eq(agents.agentId, agentId), eq(agents.currentVersion, agent.currentVersion))),
      ),
    ),
    ...writeVersionStatements(
      call.db,
      { source: call.source, now: call.now, opId: uuidv7() },
      agentId,
      agent.currentVersion,
      updated,
      { comment: 'Operator removed MCP assignment' },
    ),
    call.db
      .delete(mcpAssignments)
      .where(and(eq(mcpAssignments.agentId, agentId), eq(mcpAssignments.serverId, serverId))),
    call.db.delete(credentialGrants).where(
      and(
        eq(credentialGrants.agentId, agentId),
        inArray(
          credentialGrants.credentialId,
          removed.map((tool) => tool.credentialId),
        ),
      ),
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
