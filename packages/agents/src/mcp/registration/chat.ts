/** Shared registration progress and host-generated selection proposals for chat. @module */
import type { ManagementCall } from '../../control-plane/workflows/agents.ts'
import { parseEnum, prepareQuery, runBatch } from '../../lib/reylo.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import { record } from '../../tools/web/stream.ts'
import { mcpToken } from '../authorization/vault.ts'
import {
  mcpCatalogTools,
  mcpCommit,
  mcpServer,
  registerMcpCatalog,
  resolveMcpName,
} from './catalog.ts'
import type { McpRegistrationInput } from './chat-tool.ts'
import { consumeMcpIntent, requireMcpAgent } from './intents.ts'
import type { McpEvidence, McpIntent } from './intents.ts'
import { mcpConnectLink } from './operations.ts'
import { assignMcp, discoverMcp } from './servers.ts'
import failExpiredMcpRequests from './sql/fail-expired-mcp-requests.sql'
import insertMcpProposal from './sql/insert-mcp-proposal.sql'
import insertMcpRequest from './sql/insert-mcp-request.sql'
import markMcpRequestNotified from './sql/mark-mcp-request-notified.sql'
import selectMcpCompletedOauthForRequest from './sql/select-mcp-completed-oauth-for-request.sql'
import selectMcpProposal from './sql/select-mcp-proposal.sql'
import selectMcpRequestById from './sql/select-mcp-request-by-id.sql'
import selectMcpRequestBySourceId from './sql/select-mcp-request-by-source-id.sql'
import selectMcpRequestLatestCreated from './sql/select-mcp-request-latest-created.sql'
import selectMcpRequestLatestEntry from './sql/select-mcp-request-latest-entry.sql'
import selectTerminalMcpRequests from './sql/select-terminal-mcp-requests.sql'
import selectUnnotifiedMcpRequests from './sql/select-unnotified-mcp-requests.sql'
import updateMcpRequestAwaitingOwnerAuth from './sql/update-mcp-request-awaiting-owner-auth.sql'
import updateMcpRequestDiscovered from './sql/update-mcp-request-discovered.sql'
import updateMcpRequestReady from './sql/update-mcp-request-ready.sql'
import updateMcpRequestRecoverFailed from './sql/update-mcp-request-recover-failed.sql'
import updateMcpRequestRecoverReady from './sql/update-mcp-request-recover-ready.sql'

const MCP_REQUEST_STATUSES = [
  'awaiting_endpoint',
  'registered_unverified',
  'awaiting_owner_auth',
  'ready_for_discovery',
  'discovered',
  'failed',
] as const

interface McpRequestRow {
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

function parseMcpRequestRow(row: {
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

/** A request is scoped to its source agent and conversation, not merely its identifier. */
export async function mcpChatRequest(
  call: ManagementCall,
  evidence: McpEvidence,
  serverId?: string,
) {
  const row = await selectMcpRequestLatestCreated.run(call.db, {
    sourceAgentId: evidence.sourceAgentId,
    conversationId: evidence.conversationId,
    serverId: serverId ?? null,
  })
  return row ? parseMcpRequestRow(row) : undefined
}

/** Resume discovery only: authentication never creates an agent assignment. */
export async function completeMcpRegistration(
  call: ManagementCall,
  kek: string,
  requestId: string,
  credentialId: string,
) {
  const rawRequest = await selectMcpRequestById.run(call.db, { requestId })
  const request = rawRequest ? parseMcpRequestRow(rawRequest) : undefined
  if (!request?.serverId || request.serverRevision === null)
    throw new Error('mcp_registration_expired')
  const attached =
    ['ready_for_discovery', 'discovered'].includes(request.status) &&
    request.credentialId === credentialId
  const completed =
    !attached && request.status === 'awaiting_owner_auth'
      ? await selectMcpCompletedOauthForRequest.run(call.db, {
          requestId,
          serverId: request.serverId,
          serverRevision: request.serverRevision,
          credentialId,
        })
      : null
  if (!attached && !completed) throw new Error('mcp_registration_expired')
  const { server } = await mcpToken(call.db, kek, request.serverId, credentialId)
  if (server.revision !== request.serverRevision) throw new Error('mcp_registration_changed')
  if (request.status === 'discovered') return request
  await updateMcpRequestReady.run(call.db, { credentialId, requestId })
  await requireMcpAgent(call.db, request.sourceAgentId)
  await discoverMcp(call, kek, server.serverId, credentialId)
  await updateMcpRequestDiscovered.run(call.db, { requestId })
  return { ...request, status: 'discovered' as const, credentialId }
}

/** Recover completed authentication without repeating code exchange, consent, or assignment. */
export async function recoverMcpRegistrations(call: ManagementCall, kek: string) {
  const terminal = await selectTerminalMcpRequests.run(call.db)
  for (const row of terminal) {
    if (
      row.txStatus === 'completed' &&
      row.txCredentialId &&
      row.txServerId === row.requestServerId &&
      row.txServerRevision === row.requestServerRevision
    ) {
      await updateMcpRequestRecoverReady.run(call.db, {
        credentialId: row.txCredentialId,
        requestId: row.requestId,
      })
    } else {
      await updateMcpRequestRecoverFailed.run(call.db, { requestId: row.requestId })
    }
  }
  await failExpiredMcpRequests.run(call.db, { now: Date.now() })
  const rows = await selectUnnotifiedMcpRequests.run(call.db)
  for (const request of rows) {
    try {
      if (request.status === 'ready_for_discovery' && request.credentialId)
        await completeMcpRegistration(call, kek, request.requestId, request.credentialId)
      await call.env.AGENTS.getByName(request.sourceAgentId).mcpRegistrationNotice(
        request.requestId,
      )
      await markMcpRequestNotified.run(call.db, { now: Date.now(), requestId: request.requestId })
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
  const request = await selectMcpRequestBySourceId.run(db, { requestId, agentId })
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
  const previous = input.proposalId
    ? await selectMcpProposal.run(call.db, { proposalId: input.proposalId })
    : null
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
    await insertMcpProposal.run(call.db, {
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
  const raw = await selectMcpRequestLatestEntry.run(db, {
    sourceAgentId,
    conversationId,
    serverId: input.serverId ?? null,
  })
  if (!raw) return { status: 'registration_required' }
  const request = parseMcpRequestRow(raw)
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
        prepareQuery(call.db, insertMcpRequest, {
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
    await updateMcpRequestAwaitingOwnerAuth.run(call.db, {
      sourceAgentId: evidence.sourceAgentId,
      entryId: evidence.entryId,
      conversationId: evidence.conversationId,
    })
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
    const selected = await selectMcpProposal.run(call.db, {
      proposalId: intent.instruction.proposalId,
    })
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
