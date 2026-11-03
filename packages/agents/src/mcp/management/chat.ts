/** Shared registration progress and host-generated selection proposals for chat. @module */
import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm'
import {
  mcpProposals,
  mcpRequests,
  mcpOAuthTransactions,
} from '../../../drizzle/management/schema.ts'
import type { ManagementCall } from '../../control-plane/workflows/agents.ts'
import {
  mcpCatalogTools,
  mcpCommit,
  mcpServer,
  registerMcpCatalog,
  resolveMcpName,
} from '../storage/catalog.ts'
import { record } from '../../tools/web/stream.ts'
import { consumeMcpIntent, requireMcpAgent } from '../storage/intents.ts'
import type { McpEvidence, McpIntent } from '../storage/intents.ts'
import { mcpToken } from '../credentials/vault.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import type { McpRegistrationInput } from '../tools/registration.ts'
import { assignMcp, discoverMcp } from './servers.ts'
import { mcpConnectLink } from './operations.ts'

/** A request is scoped to its source agent and conversation, not merely its identifier. */
export async function mcpChatRequest(
  call: ManagementCall,
  evidence: McpEvidence,
  serverId?: string,
) {
  return call.db
    .select()
    .from(mcpRequests)
    .where(
      and(
        eq(mcpRequests.sourceAgentId, evidence.sourceAgentId),
        eq(mcpRequests.conversationId, evidence.conversationId),
        serverId ? eq(mcpRequests.serverId, serverId) : undefined,
      ),
    )
    .orderBy(desc(mcpRequests.createdAt))
    .get()
}

/** Resume discovery only: authentication never creates an agent assignment. */
export async function completeMcpRegistration(
  call: ManagementCall,
  kek: string,
  requestId: string,
  credentialId: string,
) {
  const request = await call.db
    .select()
    .from(mcpRequests)
    .where(eq(mcpRequests.requestId, requestId))
    .get()
  if (!request || !request.serverId || request.expiresAt <= Date.now())
    throw new Error('mcp_registration_expired')
  const { server } = await mcpToken(call.db, kek, request.serverId, credentialId)
  if (server.revision !== request.serverRevision) throw new Error('mcp_registration_changed')
  if (request.status === 'discovered') return request
  await call.db
    .update(mcpRequests)
    .set({ credentialId, status: 'ready_for_discovery' })
    .where(eq(mcpRequests.requestId, requestId))
  await requireMcpAgent(call.db, request.sourceAgentId)
  await discoverMcp(call, kek, server.serverId, credentialId)
  await call.db
    .update(mcpRequests)
    .set({ status: 'discovered' })
    .where(eq(mcpRequests.requestId, requestId))
  return { ...request, status: 'discovered', credentialId }
}

/** Recover completed authentication without repeating code exchange, consent, or assignment. */
export async function recoverMcpRegistrations(call: ManagementCall, kek: string) {
  const terminal = await call.db
    .select({ transaction: mcpOAuthTransactions, request: mcpRequests })
    .from(mcpOAuthTransactions)
    .innerJoin(mcpRequests, eq(mcpRequests.requestId, mcpOAuthTransactions.requestId))
    .where(
      and(
        eq(mcpRequests.status, 'awaiting_owner_auth'),
        inArray(mcpOAuthTransactions.status, ['completed', 'denied', 'reauth_required']),
      ),
    )
    .limit(100)
  for (const { transaction, request } of terminal) {
    await call.db
      .update(mcpRequests)
      .set(
        transaction.status === 'completed' && transaction.credentialId
          ? { status: 'ready_for_discovery', credentialId: transaction.credentialId }
          : { status: 'failed' },
      )
      .where(
        and(
          eq(mcpRequests.requestId, request.requestId),
          eq(mcpRequests.status, 'awaiting_owner_auth'),
        ),
      )
  }
  await call.db
    .update(mcpRequests)
    .set({ status: 'failed' })
    .where(
      and(
        lt(mcpRequests.expiresAt, Date.now()),
        inArray(mcpRequests.status, [
          'awaiting_endpoint',
          'registered_unverified',
          'awaiting_owner_auth',
          'ready_for_discovery',
        ]),
      ),
    )
  const rows = await call.db
    .select()
    .from(mcpRequests)
    .where(
      and(
        isNull(mcpRequests.notifiedAt),
        inArray(mcpRequests.status, ['ready_for_discovery', 'discovered', 'failed']),
      ),
    )
    .limit(100)
  for (const request of rows) {
    try {
      if (request.status === 'ready_for_discovery' && request.credentialId)
        await completeMcpRegistration(call, kek, request.requestId, request.credentialId)
      await call.env.AGENTS.getByName(request.sourceAgentId).mcpRegistrationNotice(
        request.requestId,
      )
      await call.db
        .update(mcpRequests)
        .set({ notifiedAt: Date.now() })
        .where(eq(mcpRequests.requestId, request.requestId))
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
  const request = await db
    .select()
    .from(mcpRequests)
    .where(and(eq(mcpRequests.requestId, requestId), eq(mcpRequests.sourceAgentId, agentId)))
    .get()
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
  request: typeof mcpRequests.$inferSelect,
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
    ? await call.db
        .select()
        .from(mcpProposals)
        .where(eq(mcpProposals.proposalId, input.proposalId))
        .get()
    : undefined
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
    await call.db.insert(mcpProposals).values({
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
  const request = await db
    .select()
    .from(mcpRequests)
    .where(
      and(
        eq(mcpRequests.sourceAgentId, sourceAgentId),
        eq(mcpRequests.conversationId, conversationId),
        input.serverId ? eq(mcpRequests.serverId, input.serverId) : undefined,
      ),
    )
    .orderBy(desc(mcpRequests.entryId))
    .get()
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
      await call.db.batch([
        mcpCommit(call.db, uuidv7()),
        ...consumeMcpIntent(call.db, intent),
        call.db.insert(mcpRequests).values({
          requestId: uuidv7(),
          ...evidence,
          name: instruction.name,
          status: 'awaiting_endpoint',
          expiresAt: intent.expiresAt,
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
    await call.db
      .update(mcpRequests)
      .set({ status: 'awaiting_owner_auth' })
      .where(
        and(
          eq(mcpRequests.sourceAgentId, evidence.sourceAgentId),
          eq(mcpRequests.entryId, evidence.entryId),
          eq(mcpRequests.conversationId, evidence.conversationId),
        ),
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
    const selected = await call.db
      .select()
      .from(mcpProposals)
      .where(eq(mcpProposals.proposalId, intent.instruction.proposalId))
      .get()
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
