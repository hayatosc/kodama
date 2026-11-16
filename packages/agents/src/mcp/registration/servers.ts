/** Shared MCP workflows for RPC, CLI and host-authorized chat operations.
 * Discovery never assigns tools. Each assignment is an explicit operator-selected immutable version.
 * @module
 */
import { auditStatement } from '../../control-plane/audit.ts'
import { parseSettings } from '../../control-plane/config.ts'
import { versionRow, writeVersionStatements } from '../../control-plane/versions.ts'
import { pushDesired } from '../../control-plane/workflows/agents.ts'
import type { ManagementCall } from '../../control-plane/workflows/agents.ts'
import insertCredentialGrantIgnore from '../../credentials/sql/insert-credential-grant-ignore.sql'
import { prepareQuery, runBatch } from '../../lib/reylo.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import { authorizeMcp } from '../authorization/refresh.ts'
import { mcpToken } from '../authorization/vault.ts'
import { closeMcpSession, listMcpTools, openMcpSession } from '../connection/transport.ts'
import { mcpCatalogTools, mcpServer } from './catalog.ts'
import { inspectMcpTool, mcpDigest } from './definitions.ts'
import { consumeMcpIntent, mcpIntentAudit } from './intents.ts'
import type { McpIntent } from './intents.ts'
import { mcpNoticeRecipients, mcpRevocationRecipients } from './notifications.ts'
import commitMcpAssign from './sql/commit-mcp-assign.sql'
import commitMcpProposal from './sql/commit-mcp-proposal.sql'
import commitMcpServerRevision from './sql/commit-mcp-server-revision.sql'
import commitMcpServerState from './sql/commit-mcp-server-state.sql'
import deleteMcpAssignmentsByServer from './sql/delete-mcp-assignments-by-server.sql'
import disableMcpServer from './sql/disable-mcp-server.sql'
import insertMcpAssignment from './sql/insert-mcp-assignment.sql'
import insertMcpDefinitionIgnore from './sql/insert-mcp-definition-ignore.sql'
import markMcpToolsAbsent from './sql/mark-mcp-tools-absent.sql'
import publishMcpServer from './sql/publish-mcp-server.sql'
import recordMcpInspectionError from './sql/record-mcp-inspection-error.sql'
import selectMcpProposal from './sql/select-mcp-proposal.sql'
import selectMcpToolsByServer from './sql/select-mcp-tools-by-server.sql'
import selectWorkingAgent from './sql/select-working-agent.sql'
import upsertMcpTool from './sql/upsert-mcp-tool.sql'

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
  let stale = false
  try {
    const session = await openMcpSession(server.endpoint, authorize, signal)
    try {
      inspected = await Promise.all(
        (await listMcpTools(session, authorize, signal)).map(inspectMcpTool),
      )
    } finally {
      await closeMcpSession(session, authorize)
      stale = session.stale
    }
  } catch (error) {
    const code =
      error instanceof Error && /^mcp_[a-z_]+$/u.test(error.message)
        ? error.message
        : 'mcp_unavailable'
    await recordMcpInspectionError.run(call.db, {
      inspectionError: code,
      serverId,
      revision: server.revision,
      catalogVersion: server.catalogVersion,
    })
    throw new Error(code)
  }
  if (new Set(inspected.map((tool) => tool.name)).size !== inspected.length)
    throw new Error('mcp_catalog_invalid')
  const current = await mcpServer(call.db, serverId)
  if (current.revision !== server.revision) throw new Error('mcp_server_changed')
  const previous = await selectMcpToolsByServer.run(call.db, { serverId })
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
  await runBatch(call.db, [
    prepareQuery(call.db, commitMcpServerState, {
      operationId: uuidv7(),
      serverId,
      revision: server.revision,
      catalogVersion: server.catalogVersion,
      createdAt: Date.now(),
    }),
    prepareQuery(call.db, markMcpToolsAbsent, { serverId }),
    ...tools.flatMap((tool) => [
      prepareQuery(call.db, insertMcpDefinitionIgnore, {
        digest: tool.digest,
        definitionJson: tool.definitionJson,
      }),
      prepareQuery(call.db, upsertMcpTool, tool),
    ]),
    prepareQuery(call.db, publishMcpServer, {
      catalogDigest,
      catalogVersion: server.catalogVersion + 1,
      inspectedAt: call.now,
      stale,
      updatedAt: call.now,
      serverId,
      revision: server.revision,
    }),
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

/**
 * Explicit read-only or write-capable assignment; chat-originated proposals stay read-only, while
 * write-capable RPC assignments default each selected tool's `toolPolicy` to `'ask'`.
 */
export async function assignMcp(
  call: ManagementCall,
  kek: string,
  input: {
    serverId: string
    credentialId: string
    agentId: string
    toolIds: string[]
    catalogDigest: string
    readOnly?: boolean
  },
  intent?: McpIntent,
) {
  const readOnly = input.readOnly ?? true
  if (intent && !readOnly) throw new TypeError('mcp_selection_invalid')
  if (intent) {
    const instruction = intent.instruction
    if (
      instruction.operation !== 'assign' ||
      instruction.agentId !== input.agentId ||
      JSON.stringify(instruction.toolIds) !== JSON.stringify([...input.toolIds].sort())
    )
      throw new Error('mcp_intent_mismatch')
    const proposal = await selectMcpProposal.run(call.db, { proposalId: instruction.proposalId })
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
    typeof readOnly !== 'boolean' ||
    input.toolIds.length === 0 ||
    input.toolIds.length > 100 ||
    new Set(input.toolIds).size !== input.toolIds.length
  )
    throw new TypeError('mcp_selection_invalid')
  const agent = await selectWorkingAgent.run(call.db, { agentId: input.agentId })
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
      ...(readOnly ? {} : { readOnly: false }),
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
  const selectedNames = new Set(selected.map((tool) => tool.modelName))
  const nextToolPolicy: Record<string, 'allow' | 'ask' | 'auto' | 'deny'> = {}
  for (const [name, policy] of Object.entries(settings.toolPolicy ?? {})) {
    if (!oldNames.has(name) || (selectedNames.has(name) && policy === 'deny')) {
      nextToolPolicy[name] = policy
    }
  }
  if (!readOnly) {
    for (const tool of selected) {
      if (nextToolPolicy[tool.modelName] !== 'deny') {
        nextToolPolicy[tool.modelName] = 'ask'
      }
    }
  }
  const updated = parseSettings(call.models, {
    ...settings,
    mcp: [...(settings.mcp ?? []).filter((tool) => tool.serverId !== server.serverId), ...selected],
    tools: [
      ...settings.tools.filter((name) => !oldNames.has(name)),
      ...selected.map((tool) => tool.modelName),
    ],
    toolPolicy: Object.keys(nextToolPolicy).length > 0 ? nextToolPolicy : undefined,
  })
  const commitNow = Date.now()
  await runBatch(call.db, [
    prepareQuery(call.db, commitMcpAssign, {
      operationId: uuidv7(),
      serverId: server.serverId,
      revision: server.revision,
      catalogVersion: server.catalogVersion,
      agentId: agent.agentId,
      currentVersion: agent.currentVersion,
      credentialId: input.credentialId,
      createdAt: commitNow,
    }),
    ...(intent ? consumeMcpIntent(call.db, intent) : []),
    ...(intent?.instruction.operation === 'assign'
      ? [
          prepareQuery(call.db, commitMcpProposal, {
            operationId: `proposal:${intent.instruction.proposalId}`,
            proposalId: intent.instruction.proposalId,
            sourceAgentId: intent.sourceAgentId,
            conversationId: intent.conversationId,
            createdAt: commitNow,
          }),
        ]
      : []),
    ...writeVersionStatements(
      call.db,
      { source: call.source, now: call.now, opId: uuidv7() },
      agent.agentId,
      agent.currentVersion,
      updated,
      {
        comment: readOnly
          ? 'Operator selected read-only MCP tools'
          : 'Operator selected write-capable MCP tools',
      },
    ),
    prepareQuery(call.db, deleteMcpAssignmentsByServer, {
      agentId: agent.agentId,
      serverId: server.serverId,
    }),
    ...selected.map(({ modelName: _name, readOnly: _readOnly, ...selection }) =>
      prepareQuery(call.db, insertMcpAssignment, { agentId: agent.agentId, ...selection }),
    ),
    prepareQuery(call.db, insertCredentialGrantIgnore, {
      credentialId: input.credentialId,
      agentId: agent.agentId,
    }),
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
        readOnly,
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
  await runBatch(call.db, [
    prepareQuery(call.db, commitMcpServerRevision, {
      operationId: uuidv7(),
      serverId,
      revision: server.revision,
      createdAt: Date.now(),
    }),
    prepareQuery(call.db, disableMcpServer, {
      nextRevision: server.revision + 1,
      updatedAt: call.now,
      serverId,
      expectedRevision: server.revision,
    }),
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
