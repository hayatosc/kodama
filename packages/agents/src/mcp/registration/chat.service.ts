/** Shared registration progress and host-generated selection proposals service for chat. @module */
import type { ManagementCall } from '../../control-plane/workflows/agents.service.ts'
import { runBatch } from '../../lib/reylo.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import { record } from '../../tools/web/stream.ts'
import { mcpToken } from '../authorization/vault.service.ts'
import {
  mcpCatalogTools,
  mcpCommit,
  mcpServer,
  registerMcpCatalog,
  resolveMcpName,
} from './catalog.service.ts'
import type { McpRegistrationInput } from './chat-tool.ts'
import { consumeMcpIntent, requireMcpAgent } from './intents.service.ts'
import type { McpEvidence, McpIntent } from './intents.service.ts'
import { mcpConnectLink } from './operations.service.ts'
import {
  failExpiredMcpRequests,
  findMcpCompletedOauthForRequest,
  findMcpProposal,
  findMcpRequestById,
  findMcpRequestBySourceId,
  findMcpRequestLatestCreated,
  findMcpRequestLatestEntry,
  insertMcpProposal,
  insertMcpRequestStatement,
  listTerminalMcpRequests,
  listUnnotifiedMcpRequests,
  markMcpRequestNotified,
  updateMcpRequestAwaitingOwnerAuth,
  updateMcpRequestDiscovered,
  updateMcpRequestReady,
  updateMcpRequestRecoverFailed,
  updateMcpRequestRecoverReady,
} from './requests.repository.ts'
import type { McpRequestRow } from './requests.repository.ts'
import { assignMcp, discoverMcp } from './servers.service.ts'

/** A request is scoped to its source agent and conversation, not merely its identifier. */
export async function mcpChatRequest(
  call: ManagementCall,
  evidence: McpEvidence,
  serverId?: string,
) {
  return findMcpRequestLatestCreated(
    call.db,
    evidence.sourceAgentId,
    evidence.conversationId,
    serverId ?? null,
  )
}

/** Resume discovery only: authentication never creates an agent assignment. */
export async function completeMcpRegistration(
  call: ManagementCall,
  kek: string,
  requestId: string,
  credentialId: string,
) {
  const request = await findMcpRequestById(call.db, requestId)
  if (!request?.serverId || request.serverRevision === null)
    throw new Error('mcp_registration_expired')
  const attached =
    ['ready_for_discovery', 'discovered'].includes(request.status) &&
    request.credentialId === credentialId
  const completed =
    !attached && request.status === 'awaiting_owner_auth'
      ? await findMcpCompletedOauthForRequest(call.db, {
          requestId,
          serverId: request.serverId,
          serverRevision: request.serverRevision,
          credentialId,
        })
      : undefined
  if (!attached && !completed) throw new Error('mcp_registration_expired')
  const { server } = await mcpToken(call.db, kek, request.serverId, credentialId)
  if (server.revision !== request.serverRevision) throw new Error('mcp_registration_changed')
  if (request.status === 'discovered') return request
  await updateMcpRequestReady(call.db, credentialId, requestId)
  await requireMcpAgent(call.db, request.sourceAgentId)
  await discoverMcp(call, kek, server.serverId, credentialId)
  await updateMcpRequestDiscovered(call.db, requestId)
  return { ...request, status: 'discovered' as const, credentialId }
}

/** Recover completed authentication without repeating code exchange, consent, or assignment. */
export async function recoverMcpRegistrations(call: ManagementCall, kek: string) {
  const terminal = await listTerminalMcpRequests(call.db)
  for (const row of terminal) {
    if (
      row.txStatus === 'completed' &&
      row.txCredentialId &&
      row.txServerId === row.requestServerId &&
      row.txServerRevision === row.requestServerRevision
    ) {
      await updateMcpRequestRecoverReady(call.db, row.txCredentialId, row.requestId)
    } else {
      await updateMcpRequestRecoverFailed(call.db, row.requestId)
    }
  }
  await failExpiredMcpRequests(call.db, Date.now())
  const rows = await listUnnotifiedMcpRequests(call.db)
  for (const request of rows) {
    try {
      if (request.status === 'ready_for_discovery' && request.credentialId)
        await completeMcpRegistration(call, kek, request.requestId, request.credentialId)
      await call.env.AGENTS.getByName(request.sourceAgentId).mcpRegistrationNotice(
        request.requestId,
      )
      await markMcpRequestNotified(call.db, request.requestId, Date.now())
    } catch {
      /* Retry only discovery or deduplicated notification delivery; never token exchange or assignment. */
    }
  }
}

/** Notice reads are scoped to their original object, never to model-claimed authority. */
export async function mcpRegistrationNotice(
  db: ManagementCall['db'],
  agentId: string,
  requestId: string,
) {
  const request = await findMcpRequestBySourceId(db, requestId, agentId)
  if (!request || (request.status !== 'discovered' && request.status !== 'failed'))
    throw new Error('mcp_registration_not_complete')
  return {
    source: 'mcp' as const,
    sourceId: `${request.requestId}:${request.status}`,
    outcome: request.status === 'discovered' ? ('succeeded' as const) : ('failed' as const),
    summary:
      request.status === 'discovered'
        ? `MCP discovery completed for registration ${request.requestId}. No tools were assigned. The operator can request a selection proposal.`
        : `MCP registration ${request.requestId} requires operator attention. No tools were assigned.`,
    artifactIds: [],
  }
}

function externalDescription(raw: string) {
  const value: unknown = JSON.parse(raw)
  const description = record(value).description
  return typeof description === 'string' ? description.slice(0, 8_192) : ''
}

async function proposal(
  call: Pick<ManagementCall, 'db'>,
  request: McpRequestRow,
  input: McpRegistrationInput,
) {
  if (!request.serverId || !request.credentialId || request.status !== 'discovered')
    throw new Error('mcp_discovery_required')
  const server = await mcpServer(call.db, request.serverId)
  if (!server.enabled || !server.catalogDigest || server.revision !== request.serverRevision)
    throw new Error('mcp_catalog_changed')
  const tools = await mcpCatalogTools(call.db, server.serverId)
  const agentId = input.agentId ?? request.sourceAgentId
  await requireMcpAgent(call.db, agentId)
  const page = input.page ?? 0
  if (!Number.isInteger(page) || page < 0 || page > 9) throw new Error('mcp_page_invalid')
  const previous = input.proposalId ? await findMcpProposal(call.db, input.proposalId) : undefined
  if (
    input.proposalId &&
    (!previous ||
      previous.requestId !== request.requestId ||
      previous.agentId !== agentId ||
      previous.expiresAt <= Date.now() ||
      previous.catalogDigest !== server.catalogDigest ||
      previous.serverRevision !== server.revision ||
      previous.credentialId !== request.credentialId)
  )
    throw new Error('mcp_proposal_changed')
  const proposalId = previous?.proposalId ?? uuidv7()
  if (!previous)
    await insertMcpProposal(call.db, {
      proposalId,
      requestId: request.requestId,
      sourceAgentId: request.sourceAgentId,
      conversationId: request.conversationId,
      serverId: server.serverId,
      serverRevision: server.revision,
      catalogDigest: server.catalogDigest,
      credentialId: request.credentialId,
      agentId,
      toolIdsJson: JSON.stringify(
        tools.filter((tool) => !tool.rejection).map((tool) => tool.toolId),
      ),
      expiresAt: Date.now() + 600_000,
    })
  return {
    kind: 'mcp_selection_proposal',
    proposalId,
    serverId: server.serverId,
    agentId,
    endpoint: server.endpoint,
    serverRevision: server.revision,
    inspectedAt: server.inspectedAt,
    page,
    ...(tools.length > (page + 1) * 10 ? { nextPage: page + 1 } : {}),
    credentialId: request.credentialId,
    catalogDigest: server.catalogDigest,
    tools: tools.slice(page * 10, (page + 1) * 10).map((tool) => ({
      toolId: tool.toolId,
      modelName: tool.modelName,
      digest: tool.digest,
      remoteName: tool.remoteName,
      description: externalDescription(tool.definitionJson),
      rejection: tool.rejection,
    })),
    externalData: true,
    instruction: `/mcp assign ${proposalId} TOOL_ID,TOOL_ID ${agentId}`,
    readOnly: true,
    assigned: false,
  }
}

/** Source-scoped status is safe for completion events; it cannot register, connect, discover, or assign. */
export async function readMcpChatStatus(
  db: ManagementCall['db'],
  sourceAgentId: string,
  conversationId: string,
  input: McpRegistrationInput,
) {
  await requireMcpAgent(db, sourceAgentId)
  const request = await findMcpRequestLatestEntry(
    db,
    sourceAgentId,
    conversationId,
    input.serverId ?? null,
  )
  if (!request) return { status: 'registration_required' }
  if (request.status !== 'discovered')
    return { status: request.status, requestId: request.requestId, assigned: false }
  return proposal({ db }, request, input)
}

/** Invoked only after the host verifies the still-running operator input receipts. */
export async function chatMcp(
  call: ManagementCall,
  kek: string,
  origin: string,
  evidence: McpEvidence,
  input: McpRegistrationInput,
  intent?: McpIntent,
): Promise<unknown> {
  await requireMcpAgent(call.db, evidence.sourceAgentId)
  if (input.operation === 'register') {
    if (
      !intent ||
      intent.instruction.operation !== 'register' ||
      intent.instruction.name !== input.name ||
      intent.instruction.endpoint !== input.endpoint
    )
      throw new Error('mcp_intent_required')
    const instruction = intent.instruction
    const existing = instruction.endpoint
      ? undefined
      : await resolveMcpName(call.db, instruction.name)
    const endpoint = instruction.endpoint ?? existing?.endpoint
    if (!endpoint) {
      await runBatch(call.db, [
        mcpCommit(call.db, uuidv7()),
        ...consumeMcpIntent(call.db, intent),
        insertMcpRequestStatement(call.db, {
          requestId: uuidv7(),
          sourceAgentId: evidence.sourceAgentId,
          conversationId: evidence.conversationId,
          entryId: evidence.entryId,
          submissionId: evidence.submissionId,
          serverId: null,
          serverRevision: null,
          credentialId: null,
          status: 'awaiting_endpoint',
          name: instruction.name,
          notifiedAt: null,
          expiresAt: intent.expiresAt,
          createdAt: evidence.createdAt,
        }),
      ])
      return {
        status: 'awaiting_endpoint',
        instruction:
          'Ask the operator for /mcp register NAME HTTPS_ENDPOINT; do not search or guess.',
      }
    }
    const registered = await registerMcpCatalog(
      call.db,
      instruction.name,
      endpoint,
      call.now,
      intent,
    )
    if (!registered.catalogDigest) {
      try {
        await discoverMcp(call, kek, registered.serverId, undefined)
      } catch {
        /* Inspection failure is recorded separately from registration. */
      }
    }
    await updateMcpRequestAwaitingOwnerAuth(
      call.db,
      evidence.sourceAgentId,
      evidence.entryId,
      evidence.conversationId,
    )
  }
  if (input.operation === 'assign') {
    if (
      !intent ||
      intent.instruction.operation !== 'assign' ||
      intent.instruction.proposalId !== input.proposalId ||
      intent.instruction.agentId !== input.agentId ||
      JSON.stringify(intent.instruction.toolIds) !==
        JSON.stringify([...(input.toolIds ?? [])].sort())
    )
      throw new Error('mcp_intent_required')
    const selected = await findMcpProposal(call.db, intent.instruction.proposalId)
    if (!selected) throw new Error('mcp_proposal_expired')
    return assignMcp(
      call,
      kek,
      {
        serverId: selected.serverId,
        credentialId: selected.credentialId,
        agentId: intent.instruction.agentId,
        toolIds: intent.instruction.toolIds,
        catalogDigest: selected.catalogDigest,
        readOnly: true,
      },
      intent,
    )
  }
  const request = await mcpChatRequest(call, evidence, input.serverId)
  if (!request) return { status: 'registration_required' }
  if (request.status === 'discovered') return proposal(call, request, input)
  if (input.operation === 'discover' && request.credentialId) {
    await completeMcpRegistration(call, kek, request.requestId, request.credentialId)
    const updated = await mcpChatRequest(call, evidence, request.serverId ?? undefined)
    if (updated) return proposal(call, updated, input)
  }
  if (!request.serverId) return { status: request.status }
  if (!origin)
    return {
      requestId: request.requestId,
      serverId: request.serverId,
      status: request.status,
      actionRequired: 'configure_KODAMA_UI_ORIGIN_or_attach_credential_via_private_RPC',
    }
  const link = new URL(mcpConnectLink(origin, request.serverId).url)
  link.searchParams.set('request', request.requestId)
  return {
    status: request.status,
    serverId: request.serverId,
    requestId: request.requestId,
    connectUrl: link.href,
    assigned: false,
  }
}
