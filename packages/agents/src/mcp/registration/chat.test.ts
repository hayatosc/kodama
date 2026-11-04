/** Chat registration requires durable host intent and a separate exact selection confirmation. @module */
import { env } from 'cloudflare:workers'
import { Agent } from '../../agent/agent.ts'
import { eq } from 'drizzle-orm'
import { afterEach, expect, it, vi } from 'vitest'
import {
  credentials,
  mcpAssignments,
  mcpOAuthTransactions,
  mcpProposals,
  mcpRequests,
  mcpServers,
} from '../../../drizzle/management/schema.ts'
import { management, newAgentId } from '../../testing/management.ts'
import { stopAgentObject } from '../../testing/rpc.ts'
import { createAgentModels } from '../../control-plane/models.ts'
import { rememberMcpIntent } from './intents.ts'
import * as serverWorkflows from './servers.ts'
import { manageMcpOAuth } from '../authorization/operations.ts'
import { completeMcpOAuth } from '../authorization/oauth.ts'
import { putMcpBearer } from '../authorization/vault.ts'
import { MCP_PROTOCOL } from '../connection/transport.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import {
  chatMcp,
  completeMcpRegistration,
  readMcpChatStatus,
  recoverMcpRegistrations,
} from './chat.ts'

/** Agents of the running test; a completion notice starts a model turn that outlives the test. */
const fixtureAgents: string[] = []

async function fixture() {
  const agentId = await newAgentId()
  fixtureAgents.push(agentId)
  const call = {
    env,
    db: management,
    models: createAgentModels(),
    source: 'operator' as const,
    now: Date.now(),
  }
  const evidence = {
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

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  // The fixture fetch rejects model requests, so those turns retry; stop them before the next test
  // stubs its own fetch.
  for (const agentId of fixtureAgents.splice(0)) await stopAgentObject(agentId)
})

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
    request.serverId,
    'fixture-secret',
  )
  await manageMcpOAuth(management, env.CREDENTIAL_KEK_V1, '', {
    operation: 'attach',
    requestId: request.requestId,
    credentialId: credential.credentialId,
  })
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

async function pendingRegistration() {
  const test = await fixture()
  const instruction = {
    operation: 'register',
    name: uuidv7(),
    endpoint: `https://${uuidv7()}.example.com/mcp`,
  } as const
  const intent = await rememberMcpIntent(management, test.evidence, instruction)
  await chatMcp(test.call, env.CREDENTIAL_KEK_V1, '', test.evidence, instruction, intent)
  const request = await management
    .select()
    .from(mcpRequests)
    .where(eq(mcpRequests.sourceAgentId, test.evidence.sourceAgentId))
    .get()
  if (!request?.serverId) throw new Error('Missing registration')
  return { ...test, request, serverId: request.serverId }
}

it.each(['attach', 'oauth'])(
  'recovers completed %s authentication after the original permission expires without assigning',
  async (kind) => {
    const { call, evidence, fetcher, request, serverId } = await pendingRegistration()
    let credentialId: string
    let exchanges = 0
    const discovery = fetcher.getMockImplementation()
    if (kind === 'attach') {
      credentialId = (await putMcpBearer(management, env.CREDENTIAL_KEK_V1, serverId, 'attached'))
        .credentialId
      await manageMcpOAuth(management, env.CREDENTIAL_KEK_V1, '', {
        operation: 'attach',
        requestId: request.requestId,
        credentialId,
      })
      fetcher.mockRejectedValueOnce(new Error('discovery unavailable'))
      await expect(
        completeMcpRegistration(call, env.CREDENTIAL_KEK_V1, request.requestId, credentialId),
      ).rejects.toThrow()
    } else {
      const issuer = 'https://auth.example.com/'
      fetcher.mockImplementation(async (input, options) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.endsWith('/metadata'))
          return Response.json({
            resource: `https://${new URL(url).host}/mcp`,
            authorization_servers: [issuer],
          })
        if (url === 'https://auth.example.com/.well-known/oauth-authorization-server')
          return Response.json({
            issuer,
            authorization_endpoint: `${issuer}authorize`,
            token_endpoint: `${issuer}token`,
            code_challenge_methods_supported: ['S256'],
            response_types_supported: ['code'],
            token_endpoint_auth_methods_supported: ['none'],
            client_id_metadata_document_supported: true,
          })
        if (url === `${issuer}token`) {
          exchanges++
          return Response.json({
            access_token: 'completed',
            token_type: 'Bearer',
            expires_in: 3600,
          })
        }
        if (!new Headers(options?.headers).has('Authorization'))
          return new Response(null, {
            status: 401,
            headers: {
              'WWW-Authenticate': `Bearer resource_metadata="${new URL(url).origin}/metadata"`,
            },
          })
        if (!discovery) throw new Error('Missing discovery fixture')
        return discovery(input, options)
      })
      const browserNonce = 'valid-owner-session-nonce-at-least-32-characters'
      const origin = 'https://ui.example.com'
      const started = await manageMcpOAuth(management, env.CREDENTIAL_KEK_V1, origin, {
        operation: 'begin',
        requestId: request.requestId,
        serverId,
        browserNonce,
      })
      if (
        !started ||
        typeof started !== 'object' ||
        !('authorizationUrl' in started) ||
        typeof started.authorizationUrl !== 'string'
      )
        throw new Error('Missing authorization')
      const completed = await completeMcpOAuth(management, env.CREDENTIAL_KEK_V1, origin, {
        state: new URL(started.authorizationUrl).searchParams.get('state') ?? '',
        browserNonce,
        code: 'code',
      })
      if (completed.status !== 'completed') throw new Error('Authentication failed')
      credentialId = completed.credentialId
      // Simulate stopping after the atomic OAuth completion, before the facade resumes discovery.
    }
    await management
      .update(mcpRequests)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(mcpRequests.requestId, request.requestId))
    await recoverMcpRegistrations(call, env.CREDENTIAL_KEK_V1)
    const recovered = await management
      .select()
      .from(mcpRequests)
      .where(eq(mcpRequests.requestId, request.requestId))
      .get()
    expect(recovered).toMatchObject({ status: 'discovered', credentialId })
    expect(recovered?.notifiedAt).toBeTypeOf('number')
    await recoverMcpRegistrations(call, env.CREDENTIAL_KEK_V1)
    expect(exchanges).toBe(kind === 'oauth' ? 1 : 0)
    expect(
      await management
        .select()
        .from(mcpAssignments)
        .where(eq(mcpAssignments.agentId, evidence.sourceAgentId)),
    ).toEqual([])
    await expect(
      chatMcp(call, env.CREDENTIAL_KEK_V1, '', evidence, {
        operation: 'assign',
        agentId: evidence.sourceAgentId,
        toolIds: [],
      }),
    ).rejects.toThrow('mcp_intent_required')
  },
)

it('does not revive expired unconsumed start or attachment permission with an existing credential', async () => {
  const { call, fetcher, request, serverId } = await pendingRegistration()
  const { credentialId } = await putMcpBearer(
    management,
    env.CREDENTIAL_KEK_V1,
    serverId,
    'existing',
  )
  await management
    .update(mcpRequests)
    .set({ expiresAt: Date.now() - 1 })
    .where(eq(mcpRequests.requestId, request.requestId))
  fetcher.mockClear()
  await expect(
    manageMcpOAuth(management, env.CREDENTIAL_KEK_V1, '', {
      operation: 'attach',
      requestId: request.requestId,
      credentialId,
    }),
  ).rejects.toThrow('mcp_registration_expired')
  await expect(
    manageMcpOAuth(management, env.CREDENTIAL_KEK_V1, 'https://ui.example.com', {
      operation: 'begin',
      requestId: request.requestId,
      serverId,
      browserNonce: 'valid-owner-session-nonce-at-least-32-characters',
    }),
  ).rejects.toThrow('mcp_registration_expired')
  await expect(
    completeMcpRegistration(call, env.CREDENTIAL_KEK_V1, request.requestId, credentialId),
  ).rejects.toThrow('mcp_registration_expired')
  await recoverMcpRegistrations(call, env.CREDENTIAL_KEK_V1)
  expect(fetcher).not.toHaveBeenCalled()
  expect(
    await management
      .select()
      .from(mcpRequests)
      .where(eq(mcpRequests.requestId, request.requestId))
      .get(),
  ).toMatchObject({ status: 'failed' })
})

it.each(['server', 'credential'])(
  'checks the live %s before recovering a completed attachment',
  async (changed) => {
    const { call, fetcher, request, serverId } = await pendingRegistration()
    const { credentialId } = await putMcpBearer(
      management,
      env.CREDENTIAL_KEK_V1,
      serverId,
      'existing',
    )
    await manageMcpOAuth(management, env.CREDENTIAL_KEK_V1, '', {
      operation: 'attach',
      requestId: request.requestId,
      credentialId,
    })
    await management
      .update(mcpRequests)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(mcpRequests.requestId, request.requestId))
    if (changed === 'server')
      await management
        .update(mcpServers)
        .set({ revision: 2 })
        .where(eq(mcpServers.serverId, serverId))
    else
      await management
        .update(credentials)
        .set({ status: 'revoked' })
        .where(eq(credentials.credentialId, credentialId))
    fetcher.mockClear()
    await expect(
      completeMcpRegistration(call, env.CREDENTIAL_KEK_V1, request.requestId, credentialId),
    ).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  },
)

/** Persist the atomic OAuth completion boundary without replaying an exchange in recovery. */
function completedTransaction(
  request: typeof mcpRequests.$inferSelect,
  credentialId: string,
): typeof mcpOAuthTransactions.$inferInsert {
  if (!request.serverId || request.serverRevision === null) throw new Error('Missing server')
  return {
    requestId: request.requestId,
    transactionId: uuidv7(),
    serverId: request.serverId,
    serverRevision: request.serverRevision,
    stateDigest: uuidv7(),
    browserDigest: uuidv7(),
    bindingJson: '{}',
    verifierId: uuidv7(),
    status: 'completed',
    credentialId,
    expiresAt: request.expiresAt,
    createdAt: request.createdAt,
  }
}

it('recovers all 101 expired completed OAuth requests across bounded batches without exchange or assignment', async () => {
  const { call, evidence, request, serverId, fetcher } = await pendingRegistration()
  // Keep 101 real D1 recoveries, but inspect this shared fixture's catalog only once.
  // Adjacent single-request cases cover real discovery and the durable completion notice.
  const discover = serverWorkflows.discoverMcp
  let inspected: ReturnType<typeof discover> | undefined
  const inspection = vi.spyOn(serverWorkflows, 'discoverMcp').mockImplementation((...args) => {
    inspected ??= discover(...args)
    return inspected
  })
  const notice = vi.fn<(requestId: string) => Promise<void>>().mockResolvedValue()
  vi.spyOn(Agent.prototype, 'mcpRegistrationNotice').mockImplementation(notice)
  const { credentialId } = await putMcpBearer(
    management,
    env.CREDENTIAL_KEK_V1,
    serverId,
    'completed',
  )
  const requests = Array.from({ length: 101 }, (_, index) => ({
    ...request,
    requestId: index === 0 ? request.requestId : uuidv7(),
    entryId: index + 1,
    expiresAt: Date.now() - 1,
  }))
  await management.batch([
    management
      .update(mcpRequests)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(mcpRequests.requestId, request.requestId)),
    ...requests.slice(1).map((row) => management.insert(mcpRequests).values(row)),
    ...requests.map((row) =>
      management.insert(mcpOAuthTransactions).values(completedTransaction(row, credentialId)),
    ),
  ])
  fetcher.mockClear()
  await recoverMcpRegistrations(call, env.CREDENTIAL_KEK_V1)
  const first = await management
    .select()
    .from(mcpRequests)
    .where(eq(mcpRequests.sourceAgentId, evidence.sourceAgentId))
  expect(first.filter((row) => row.status === 'awaiting_owner_auth')).toHaveLength(1)
  expect(
    first.filter((row) => ['ready_for_discovery', 'discovered'].includes(row.status)),
  ).toHaveLength(100)
  await recoverMcpRegistrations(call, env.CREDENTIAL_KEK_V1)
  const recovered = await management
    .select()
    .from(mcpRequests)
    .where(eq(mcpRequests.sourceAgentId, evidence.sourceAgentId))
  expect(recovered).toHaveLength(101)
  expect(notice.mock.calls.map(([requestId]) => requestId).sort()).toEqual(
    requests.map((row) => row.requestId).sort(),
  )
  expect(inspection).toHaveBeenCalledTimes(101)
  expect(
    inspection.mock.calls.every((args) => args[2] === serverId && args[3] === credentialId),
  ).toBe(true)
  expect(
    recovered.every((row) => row.status === 'discovered' && row.credentialId === credentialId),
  ).toBe(true)
  const server = await management
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.serverId, serverId))
    .get()
  expect(fetcher.mock.calls.length).toBeGreaterThan(0)
  expect(fetcher.mock.calls.every(([url]) => url === server?.endpoint)).toBe(true)
  expect(
    await management
      .select()
      .from(mcpAssignments)
      .where(eq(mcpAssignments.agentId, evidence.sourceAgentId)),
  ).toEqual([])
}, 30_000)

it('keeps OAuth completion committed between the terminal read and expiry sweep recoverable', async () => {
  const { call, evidence, request, serverId, fetcher } = await pendingRegistration()
  const { credentialId } = await putMcpBearer(
    management,
    env.CREDENTIAL_KEK_V1,
    serverId,
    'completed',
  )
  await management
    .update(mcpRequests)
    .set({ expiresAt: Date.now() - 1 })
    .where(eq(mcpRequests.requestId, request.requestId))
  const transaction = completedTransaction(request, credentialId)
  await management.insert(mcpOAuthTransactions).values({
    ...transaction,
    status: 'exchanging',
    credentialId: null,
  })
  const prepare = env.MANAGEMENT_DB.prepare.bind(env.MANAGEMENT_DB)
  let completed = false
  const spy = vi.spyOn(env.MANAGEMENT_DB, 'prepare').mockImplementation((query) => {
    const statement = prepare(query)
    if (!query.startsWith('select ') || !query.includes('from "mcp_oauth_transactions"'))
      return statement
    spy.mockRestore()
    const bind = statement.bind.bind(statement)
    vi.spyOn(statement, 'bind').mockImplementation((...values) => {
      const bound = bind(...values)
      const raw = bound.raw.bind(bound)
      vi.spyOn(bound, 'raw').mockImplementation(
        async <T = unknown[]>(options?: { columnNames?: false }) => {
          const rows = await raw<T>(options)
          await management
            .update(mcpOAuthTransactions)
            .set({ status: 'completed', credentialId })
            .where(eq(mcpOAuthTransactions.transactionId, transaction.transactionId))
          completed = true
          return rows
        },
      )
      return bound
    })
    return statement
  })
  fetcher.mockClear()
  await recoverMcpRegistrations(call, env.CREDENTIAL_KEK_V1)
  expect(completed).toBe(true)
  expect(
    await management
      .select()
      .from(mcpRequests)
      .where(eq(mcpRequests.requestId, request.requestId))
      .get(),
  ).toMatchObject({ status: 'awaiting_owner_auth' })
  expect(fetcher).not.toHaveBeenCalled()
  await recoverMcpRegistrations(call, env.CREDENTIAL_KEK_V1)
  expect(
    await management
      .select()
      .from(mcpRequests)
      .where(eq(mcpRequests.requestId, request.requestId))
      .get(),
  ).toMatchObject({ status: 'discovered', credentialId })
  const server = await management
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.serverId, serverId))
    .get()
  expect(fetcher.mock.calls.length).toBeGreaterThan(0)
  expect(fetcher.mock.calls.every(([url]) => url === server?.endpoint)).toBe(true)
  expect(
    await management
      .select()
      .from(mcpAssignments)
      .where(eq(mcpAssignments.agentId, evidence.sourceAgentId)),
  ).toEqual([])
})
