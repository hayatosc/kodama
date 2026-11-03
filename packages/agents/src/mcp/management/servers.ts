/** Shared MCP workflows for RPC, CLI and host-authorized chat operations.
 * Discovery never assigns tools. Each assignment is an explicit operator-selected immutable version.
 * @module
 */
import { mcpNoticeRecipients, mcpRevocationRecipients } from '../storage/notifications.ts'
import { consumeMcpIntent, mcpIntentAudit } from '../storage/intents.ts'
import type { McpIntent } from '../storage/intents.ts'
import { mcpProposals } from '../../../drizzle/management/schema.ts'
import { and, eq, exists } from 'drizzle-orm'
import {
  agents,
  credentialGrants,
  credentials,
  mcpAssignments,
  mcpDefinitions,
  mcpServers,
  mcpTools,
} from '../../../drizzle/management/schema.ts'
import { authorizeMcp } from '../credentials/refresh.ts'
import { mcpToken } from '../credentials/vault.ts'
import { inspectMcpTool, mcpDigest } from '../tools/definitions.ts'
import { closeMcpSession, listMcpTools, openMcpSession } from '../tools/transport.ts'
import { mcpCatalogTools, mcpCommit, mcpServer } from '../storage/catalog.ts'
import { auditStatement } from '../../control-plane/audit.ts'
import { parseSettings } from '../../control-plane/config.ts'
import { versionRow, writeVersionStatements } from '../../control-plane/versions.ts'
import { pushDesired } from '../../control-plane/workflows/agents.ts'
import type { ManagementCall } from '../../control-plane/workflows/agents.ts'
import { uuidv7 } from '../../lib/uuid.ts'

/** Reconciliation and mutations project invalid selections into the existing durable inbox. */
export async function notifyMcpAssignments(call: ManagementCall, serverId?: string) {
  if (!serverId)
    for (const recipient of await mcpRevocationRecipients(call.db)) {
      try {
        await call.env.AGENTS.getByName(recipient.agentId).mcpCredentialNotice(
          recipient.credentialId,
        )
      } catch {
        /* The existing inbox deduplicates the next reconciliation attempt. */
      }
    }
  for (const recipient of await mcpNoticeRecipients(call.db, serverId)) {
    try {
      await call.env.AGENTS.getByName(recipient.agentId).mcpCatalogNotice(recipient.serverId)
    } catch {
      /* Daily reconciliation retries notification delivery, never the tool call. */
    }
  }
}

/** Publish only a complete validated discovery; failed inspection leaves the previous catalog intact. */
export async function discoverMcp(
  call: ManagementCall,
  kek: string,
  serverId: string,
  credentialId: string | undefined,
) {
  const server = await mcpServer(call.db, serverId)
  const signal = AbortSignal.timeout(10_000)
  const authorize = async () => {
    const current = await mcpServer(call.db, serverId)
    if (current.revision !== server.revision) throw new Error('mcp_server_changed')
    return credentialId
      ? authorizeMcp(call.db, kek, serverId, credentialId, server.endpoint, signal)
      : undefined
  }
  let inspected: Awaited<ReturnType<typeof inspectMcpTool>>[]
  try {
    const session = await openMcpSession(server.endpoint, authorize, signal)
    try {
      inspected = await Promise.all(
        (await listMcpTools(session, authorize, signal)).map(inspectMcpTool),
      )
    } finally {
      await closeMcpSession(session, authorize)
    }
  } catch (error) {
    const code =
      error instanceof Error && /^mcp_[a-z_]+$/u.test(error.message)
        ? error.message
        : 'mcp_unavailable'
    await call.db
      .update(mcpServers)
      .set({ inspectionError: code })
      .where(
        and(
          eq(mcpServers.serverId, serverId),
          eq(mcpServers.revision, server.revision),
          eq(mcpServers.catalogVersion, server.catalogVersion),
        ),
      )
    throw new Error(code)
  }
  if (new Set(inspected.map((tool) => tool.name)).size !== inspected.length)
    throw new Error('mcp_catalog_invalid')
  const current = await mcpServer(call.db, serverId)
  if (current.revision !== server.revision) throw new Error('mcp_server_changed')
  const previous = await call.db.select().from(mcpTools).where(eq(mcpTools.serverId, serverId))
  const tools = inspected.map((tool) => {
    const old = previous.find((entry) => entry.remoteName === tool.name)
    const toolId = old?.toolId ?? uuidv7()
    return {
      toolId,
      serverId,
      remoteName: tool.name,
      modelName: old?.modelName ?? `mcp_${server.shortId}_${toolId.replaceAll('-', '').slice(12)}`,
      serverRevision: server.revision,
      digest: tool.digest,
      definitionJson: JSON.stringify(tool.definition),
      rejection: tool.rejection,
      present: true,
    }
  })
  const catalogDigest = await mcpDigest(
    tools
      .map(({ toolId, digest, rejection }) => ({ toolId, digest, rejection }))
      .sort((a, b) => a.toolId.localeCompare(b.toolId)),
  )
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
              eq(mcpServers.serverId, serverId),
              eq(mcpServers.revision, server.revision),
              eq(mcpServers.catalogVersion, server.catalogVersion),
            ),
          ),
      ),
    ),
    call.db.update(mcpTools).set({ present: false }).where(eq(mcpTools.serverId, serverId)),
    ...tools.flatMap((tool) => [
      call.db
        .insert(mcpDefinitions)
        .values({ digest: tool.digest, definitionJson: tool.definitionJson })
        .onConflictDoNothing(),
      call.db
        .insert(mcpTools)
        .values(tool)
        .onConflictDoUpdate({ target: mcpTools.toolId, set: tool }),
    ]),
    call.db
      .update(mcpServers)
      .set({
        catalogDigest,
        catalogVersion: server.catalogVersion + 1,
        inspectedAt: call.now,
        inspectionError: null,
        stale: false,
        updatedAt: call.now,
        enabled: true,
      })
      .where(and(eq(mcpServers.serverId, serverId), eq(mcpServers.revision, server.revision))),
    auditStatement(call.db, {
      opId: uuidv7(),
      at: call.now,
      source: call.source,
      action: 'mcp.discover',
      targetKind: 'system',
      targetId: serverId,
      detail: { revision: server.revision, catalogDigest, toolCount: tools.length },
    }),
  ])
  await notifyMcpAssignments(call, serverId)
  return { serverId, catalogDigest, inspectedAt: call.now, tools }
}

/** Explicit read-only attestation is required; annotations are not authority to select a tool. */
export async function assignMcp(
  call: ManagementCall,
  kek: string,
  input: {
    serverId: string
    credentialId: string
    agentId: string
    toolIds: string[]
    catalogDigest: string
    readOnly: true
  },
  intent?: McpIntent,
) {
  if (intent) {
    const instruction = intent.instruction
    if (
      instruction.operation !== 'assign' ||
      instruction.agentId !== input.agentId ||
      JSON.stringify(instruction.toolIds) !== JSON.stringify([...input.toolIds].sort())
    )
      throw new Error('mcp_intent_mismatch')
    const proposal = await call.db
      .select()
      .from(mcpProposals)
      .where(eq(mcpProposals.proposalId, instruction.proposalId))
      .get()
    if (
      !proposal ||
      proposal.sourceAgentId !== intent.sourceAgentId ||
      proposal.conversationId !== intent.conversationId ||
      proposal.agentId !== input.agentId ||
      proposal.serverId !== input.serverId ||
      proposal.credentialId !== input.credentialId ||
      proposal.catalogDigest !== input.catalogDigest ||
      proposal.expiresAt <= Date.now()
    )
      throw new Error('mcp_proposal_expired')
    const toolIds: unknown = JSON.parse(proposal.toolIdsJson)
    if (!Array.isArray(toolIds) || input.toolIds.some((id) => !toolIds.includes(id)))
      throw new Error('mcp_selection_invalid')
  }
  const { server, value } = await mcpToken(call.db, kek, input.serverId, input.credentialId)
  if (!server.enabled || server.catalogDigest !== input.catalogDigest)
    throw new Error('mcp_catalog_changed')
  if (
    input.readOnly !== true ||
    input.toolIds.length === 0 ||
    input.toolIds.length > 100 ||
    new Set(input.toolIds).size !== input.toolIds.length
  )
    throw new TypeError('mcp_selection_invalid')
  const agent = await call.db
    .select()
    .from(agents)
    .where(and(eq(agents.agentId, input.agentId), eq(agents.kind, 'working')))
    .get()
  if (!agent || agent.status !== 'active') throw new Error('mcp_agent_unavailable')
  const catalog = await mcpCatalogTools(call.db, input.serverId)
  const selected = input.toolIds.map((id) => {
    const tool = catalog.find((entry) => entry.toolId === id)
    if (!tool || tool.rejection || tool.serverRevision !== server.revision)
      throw new Error('mcp_tool_unavailable')
    return {
      toolId: tool.toolId,
      modelName: tool.modelName,
      digest: tool.digest,
      serverId: server.serverId,
      serverRevision: server.revision,
      credentialId: input.credentialId,
    }
  })
  if (
    value.expiresAt !== null &&
    value.expiresAt <= call.now &&
    (value.kind !== 'mcp_oauth' || !value.refresh)
  )
    throw new Error('mcp_reauth_required')
  const previous = await versionRow(call.db, agent.agentId, agent.currentVersion)
  if (!previous) throw new Error('mcp_agent_config_missing')
  const settings = parseSettings(call.models, JSON.parse(previous.settingsJson))
  const oldNames = new Set(
    settings.mcp?.filter((tool) => tool.serverId === server.serverId).map((tool) => tool.modelName),
  )
  const updated = parseSettings(call.models, {
    ...settings,
    mcp: [...(settings.mcp ?? []).filter((tool) => tool.serverId !== server.serverId), ...selected],
    tools: [
      ...settings.tools.filter((name) => !oldNames.has(name)),
      ...selected.map((tool) => tool.modelName),
    ],
  })
  await call.db.batch([
    mcpCommit(
      call.db,
      uuidv7(),
      and(
        exists(
          call.db
            .select()
            .from(mcpServers)
            .where(
              and(
                eq(mcpServers.serverId, server.serverId),
                eq(mcpServers.enabled, true),
                eq(mcpServers.revision, server.revision),
                eq(mcpServers.catalogVersion, server.catalogVersion),
              ),
            ),
        ),
        exists(
          call.db
            .select()
            .from(agents)
            .where(
              and(
                eq(agents.agentId, agent.agentId),
                eq(agents.status, 'active'),
                eq(agents.currentVersion, agent.currentVersion),
              ),
            ),
        ),
        exists(
          call.db
            .select()
            .from(credentials)
            .where(
              and(
                eq(credentials.credentialId, input.credentialId),
                eq(credentials.status, 'active'),
              ),
            ),
        ),
      ),
    ),
    ...(intent ? consumeMcpIntent(call.db, intent) : []),
    ...(intent?.instruction.operation === 'assign'
      ? [
          mcpCommit(
            call.db,
            `proposal:${intent.instruction.proposalId}`,
            exists(
              call.db
                .select()
                .from(mcpProposals)
                .where(
                  and(
                    eq(mcpProposals.proposalId, intent.instruction.proposalId),
                    eq(mcpProposals.sourceAgentId, intent.sourceAgentId),
                    eq(mcpProposals.conversationId, intent.conversationId),
                  ),
                ),
            ),
          ),
        ]
      : []),
    ...writeVersionStatements(
      call.db,
      { source: call.source, now: call.now, opId: uuidv7() },
      agent.agentId,
      agent.currentVersion,
      updated,
      { comment: 'Operator selected read-only MCP tools' },
    ),
    call.db
      .delete(mcpAssignments)
      .where(
        and(
          eq(mcpAssignments.agentId, agent.agentId),
          eq(mcpAssignments.serverId, server.serverId),
        ),
      ),
    ...selected.map(({ modelName: _name, ...selection }) =>
      call.db.insert(mcpAssignments).values({ agentId: agent.agentId, ...selection }),
    ),
    call.db
      .insert(credentialGrants)
      .values({ credentialId: input.credentialId, agentId: agent.agentId })
      .onConflictDoNothing(),
    auditStatement(call.db, {
      opId: uuidv7(),
      at: call.now,
      source: call.source,
      action: 'mcp.assign',
      targetKind: 'agent',
      targetId: agent.agentId,
      detail: {
        serverId: server.serverId,
        credentialId: input.credentialId,
        toolIds: input.toolIds,
        catalogDigest: input.catalogDigest,
        readOnly: true,
        ...(intent ? mcpIntentAudit(intent) : { origin: 'rpc' }),
      },
    }),
  ])
  const apply = intent ? undefined : await pushDesired(call, agent.agentId)
  return { agentId: agent.agentId, version: agent.currentVersion + 1, apply }
}

/** Invalidation is immediate at the guard, regardless of pending configuration versions. */
export async function disableMcp(call: ManagementCall, serverId: string) {
  const server = await mcpServer(call.db, serverId)
  await call.db.batch([
    mcpCommit(
      call.db,
      uuidv7(),
      exists(
        call.db
          .select()
          .from(mcpServers)
          .where(and(eq(mcpServers.serverId, serverId), eq(mcpServers.revision, server.revision))),
      ),
    ),
    call.db
      .update(mcpServers)
      .set({ enabled: false, revision: server.revision + 1, updatedAt: call.now })
      .where(and(eq(mcpServers.serverId, serverId), eq(mcpServers.revision, server.revision))),
    auditStatement(call.db, {
      opId: uuidv7(),
      at: call.now,
      source: call.source,
      action: 'mcp.disable',
      targetKind: 'system',
      targetId: serverId,
      detail: { revision: server.revision + 1 },
    }),
  ])
  await notifyMcpAssignments(call, serverId)
  return { serverId, enabled: false }
}
