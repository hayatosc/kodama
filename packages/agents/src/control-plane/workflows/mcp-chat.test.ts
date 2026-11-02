/** Chat registration requires durable host intent and a separate exact selection confirmation. @module */
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { afterEach, expect, it, vi } from 'vitest'
import {
  mcpAssignments,
  mcpProposals,
  mcpRequests,
  principals,
} from '../../../drizzle/management/schema.ts'
import { caller, management, newAgentId, principalIdOf } from '../../testing/management.ts'
import { createAgentModels } from '../models.ts'
import { rememberMcpIntent } from '../mcp-intents.ts'
import { putMcpBearer } from '../../credentials/mcp-vault.ts'
import { MCP_PROTOCOL } from '../../tools/mcp/transport.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import { chatMcp, completeMcpRegistration, readMcpChatStatus } from './mcp-chat.ts'

async function fixture() {
  const agentId = await newAgentId()
  const principalId = await principalIdOf(await caller())
  const principal = await management
    .select()
    .from(principals)
    .where(eq(principals.principalId, principalId))
    .get()
  if (!principal) throw new Error('Missing owner')
  const call = { env, db: management, models: createAgentModels(), principal, now: Date.now() }
  const evidence = {
    principalId,
    sourceAgentId: agentId,
    conversationId: 'root',
    entryId: 1,
    submissionId: uuidv7(),
    createdAt: Date.now(),
  }
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
    if (options?.method === 'DELETE') return new Response(null, { status: 204 })
    const value: unknown = JSON.parse(typeof options?.body === 'string' ? options.body : '{}')
    if (!value || typeof value !== 'object' || !('method' in value))
      throw new Error('Unexpected request')
    if (value.method === 'notifications/initialized') return new Response(null, { status: 202 })
    if (!('id' in value)) throw new Error('Missing ID')
    return Response.json({
      jsonrpc: '2.0',
      id: value.id,
      result:
        value.method === 'initialize'
          ? { protocolVersion: MCP_PROTOCOL, capabilities: { tools: {} } }
          : {
              tools: [
                {
                  name: 'read',
                  description: 'External description',
                  inputSchema: { type: 'object' },
                },
              ],
            },
    })
  })
  vi.stubGlobal('fetch', fetcher)
  return { call, evidence, fetcher }
}

afterEach(() => vi.unstubAllGlobals())

it('asks for an unknown endpoint without searching or guessing, and consumes that intent once', async () => {
  const { call, evidence, fetcher } = await fixture()
  const instruction = { operation: 'register', name: uuidv7() } as const
  const intent = await rememberMcpIntent(management, evidence, instruction)
  expect(
    await chatMcp(call, env.CREDENTIAL_KEK_V1, '', evidence, instruction, intent),
  ).toMatchObject({ status: 'awaiting_endpoint' })
  expect(fetcher).not.toHaveBeenCalled()
  await expect(
    chatMcp(call, env.CREDENTIAL_KEK_V1, '', evidence, instruction, intent),
  ).rejects.toThrow()
  expect(
    await management
      .select()
      .from(mcpRequests)
      .where(eq(mcpRequests.sourceAgentId, evidence.sourceAgentId)),
  ).toHaveLength(1)
})

it('requires exact intent, leaves OAuth or credential attachment unassigned, then consumes one explicit proposal confirmation', async () => {
  const { call, evidence } = await fixture()
  const instruction = {
    operation: 'register',
    name: uuidv7(),
    endpoint: `https://${uuidv7()}.example.com/mcp`,
  } as const
  await expect(chatMcp(call, env.CREDENTIAL_KEK_V1, '', evidence, instruction)).rejects.toThrow(
    'mcp_intent_required',
  )
  const intent = await rememberMcpIntent(management, evidence, instruction)
  await expect(
    chatMcp(
      call,
      env.CREDENTIAL_KEK_V1,
      '',
      evidence,
      { ...instruction, endpoint: 'https://other.example.com/mcp' },
      intent,
    ),
  ).rejects.toThrow('mcp_intent_required')
  await chatMcp(call, env.CREDENTIAL_KEK_V1, '', evidence, instruction, intent)
  const request = await management
    .select()
    .from(mcpRequests)
    .where(eq(mcpRequests.sourceAgentId, evidence.sourceAgentId))
    .get()
  if (!request?.serverId) throw new Error('Missing request')
  const credential = await putMcpBearer(
    management,
    env.CREDENTIAL_KEK_V1,
    evidence.principalId,
    request.serverId,
    'fixture-secret',
  )
  await completeMcpRegistration(
    call,
    env.CREDENTIAL_KEK_V1,
    request.requestId,
    credential.credentialId,
  )
  expect(
    await management
      .select()
      .from(mcpAssignments)
      .where(eq(mcpAssignments.agentId, evidence.sourceAgentId)),
  ).toEqual([])
  await readMcpChatStatus(management, evidence.sourceAgentId, evidence.conversationId, {
    operation: 'status',
  })
  const proposal = await management
    .select()
    .from(mcpProposals)
    .where(eq(mcpProposals.requestId, request.requestId))
    .get()
  if (!proposal) throw new Error('Missing proposal')
  const ids: unknown = JSON.parse(proposal.toolIdsJson)
  if (!Array.isArray(ids) || typeof ids[0] !== 'string') throw new Error('Missing tool')
  const selection = {
    operation: 'assign',
    proposalId: proposal.proposalId,
    toolIds: [ids[0]],
    agentId: evidence.sourceAgentId,
  } as const
  const confirmation = { ...selection, toolIds: [...selection.toolIds] }
  await expect(chatMcp(call, env.CREDENTIAL_KEK_V1, '', evidence, confirmation)).rejects.toThrow(
    'mcp_intent_required',
  )
  const next = { ...evidence, entryId: 2, submissionId: uuidv7(), createdAt: Date.now() }
  const confirmed = await rememberMcpIntent(management, next, confirmation)
  await chatMcp(call, env.CREDENTIAL_KEK_V1, '', next, confirmation, confirmed)
  expect(
    await management
      .select()
      .from(mcpAssignments)
      .where(eq(mcpAssignments.agentId, evidence.sourceAgentId)),
  ).toHaveLength(1)
  await expect(
    chatMcp(call, env.CREDENTIAL_KEK_V1, '', next, confirmation, confirmed),
  ).rejects.toThrow()
})
