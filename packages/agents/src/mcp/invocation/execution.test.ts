/** Pinned dynamic MCP tools through real Durable Object execution and eviction. @module */
import { env, exports } from 'cloudflare:workers'
import { evictDurableObject, runInDurableObject } from 'cloudflare:test'
import { eq, and } from 'drizzle-orm'
import { credentials, credentialGrants } from '../../../drizzle/management/schema.ts'
import { expect, it, vi } from 'vitest'
import { mcpCalls } from '../../../drizzle/durable-object/schema.ts'
import { management, newAgentId, updateSettings } from '../../testing/management.ts'
import { useMockModel, waitForAnswer } from '../../testing/rpc.ts'
import { textResponse, toolCallResponse } from '../../testing/model.ts'
import { registerMcpCatalog } from '../registration/catalog.ts'
import { createAgentModels } from '../../control-plane/models.ts'
import { assignMcp, discoverMcp } from '../registration/servers.ts'
import { putMcpBearer } from '../authorization/vault.ts'
import { disconnectMcp } from '../authorization/refresh.ts'
import { MCP_PROTOCOL } from '../connection/transport.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import { beginMcpCall, finishMcpCall, interruptMcpCalls } from './calls.ts'
import { piTasks } from '../../agent/local-db/pi-tables.ts'
import { COMPACT_AFTER_TURN_7, compactedAgent, mockModel } from '../../testing/conversation.ts'
import { openLocalDb } from '../../agent/local-db/local.ts'

useMockModel()

async function fixture(failure = false, requests = failure ? 2 : 1) {
  const agentId = await newAgentId()
  await updateSettings(agentId, { memoryPolicy: { remember: false, extract: false } })
  const call = {
    env,
    db: management,
    models: createAgentModels(),
    source: 'operator' as const,
    now: Date.now(),
  }
  const endpoint = `https://${uuidv7()}.example.com/mcp`
  const server = await registerMcpCatalog(management, 'runtime', endpoint, call.now)
  const credential = await putMcpBearer(
    management,
    env.CREDENTIAL_KEK_V1,
    server.serverId,
    'fixture-token',
  )
  let modelName = ''
  let modelCalls = 0
  let remoteCalls = 0
  let observedOutput = ''
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    const address = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
    if (address !== endpoint) {
      modelCalls++
      if (modelCalls <= requests) return toolCallResponse({ name: modelName, arguments: {} })
      observedOutput = typeof options?.body === 'string' ? options.body : ''
      return textResponse('Finished')
    }
    if (options?.method === 'DELETE') return new Response(null, { status: 204 })
    const value: unknown = JSON.parse(typeof options?.body === 'string' ? options.body : '{}')
    if (!value || typeof value !== 'object' || !('method' in value))
      throw new Error('Unexpected request')
    if (value.method === 'notifications/initialized') return new Response(null, { status: 202 })
    if (!('id' in value)) throw new Error('Missing ID')
    let result: unknown = { protocolVersion: MCP_PROTOCOL, capabilities: { tools: {} } }
    if (value.method === 'tools/list')
      result = { tools: [{ name: 'read', inputSchema: { type: 'object' } }] }
    if (value.method === 'tools/call') {
      remoteCalls++
      if (failure) return new Response('private upstream error', { status: 500 })
      result = { content: [{ type: 'text', text: 'External fixture data' }] }
    }
    return Response.json(
      { jsonrpc: '2.0', id: value.id, result },
      {
        headers: { 'Mcp-Session-Id': 'fixture-session' },
      },
    )
  })
  const discovered = await discoverMcp(
    call,
    env.CREDENTIAL_KEK_V1,
    server.serverId,
    credential.credentialId,
  )
  const tool = discovered.tools[0]
  if (!tool) throw new Error('Missing tool')
  modelName = tool.modelName
  await assignMcp(call, env.CREDENTIAL_KEK_V1, {
    serverId: server.serverId,
    credentialId: credential.credentialId,
    agentId,
    toolIds: [tool.toolId],
    catalogDigest: discovered.catalogDigest,
    readOnly: true,
  })
  return {
    agentId,
    server,
    credential,
    call,
    tool,
    discovered,
    remoteCalls: () => remoteCalls,
    observedOutput: () => observedOutput,
  }
}

it('loads only assigned pinned definitions after eviction and envelopes external output', async () => {
  const test = await fixture()
  await evictDurableObject(env.AGENTS.getByName(test.agentId))
  await exports.default.sendMessage(test.agentId, {
    requestId: 'mcp-read',
    content: 'Read the selected source',
  })
  await waitForAnswer(test.agentId, 'mcp-read')
  expect(test.remoteCalls()).toBe(1)
  expect(test.observedOutput()).toContain('untrusted_external_data')
  expect(test.observedOutput()).toContain('External fixture data')
  expect(test.observedOutput()).not.toContain('fixture-token')
})

it('never resends a failed call when the model asks again in the same run', async () => {
  const test = await fixture(true)
  await exports.default.sendMessage(test.agentId, {
    requestId: 'mcp-failure',
    content: 'Read the selected source',
  })
  await waitForAnswer(test.agentId, 'mcp-failure')
  expect(test.remoteCalls()).toBe(1)
  expect(test.observedOutput()).not.toContain('private upstream error')
  await runInDurableObject(env.AGENTS.getByName(test.agentId), async (_agent, state) => {
    const local = await openLocalDb(state.storage)
    expect(local.select().from(mcpCalls).all()).toMatchObject([{ state: 'failed' }])
  })
})

it('rejects revoked credentials even while the old selected tool remains installed', async () => {
  const test = await fixture()
  await disconnectMcp(
    management,
    env.CREDENTIAL_KEK_V1,
    test.server.serverId,
    test.credential.credentialId,
  )
  await exports.default.sendMessage(test.agentId, {
    requestId: 'mcp-revoked',
    content: 'Read the selected source',
  })
  await waitForAnswer(test.agentId, 'mcp-revoked')
  expect(test.remoteCalls()).toBe(0)
})

it('permits acknowledged repeated reads in one operator epoch and preserves them on reconciliation', async () => {
  const test = await fixture(false, 2)
  await runInDurableObject(env.AGENTS.getByName(test.agentId), (agent) =>
    agent.sendMessage({ requestId: 'mcp-repeat', content: 'Read twice' }),
  )
  await waitForAnswer(test.agentId, 'mcp-repeat')
  expect(test.remoteCalls()).toBe(2)
  await runInDurableObject(env.AGENTS.getByName(test.agentId), async (_agent, state) => {
    const local = await openLocalDb(state.storage)
    interruptMcpCalls(local)
    expect(
      local
        .select()
        .from(mcpCalls)
        .all()
        .map((call) => call.state),
    ).toEqual(['succeeded', 'succeeded'])
  })
})

it('preserves committed success through actual pruning and harness reopening without trusting missing tasks', async () => {
  const test = await fixture()
  const remote = vi.mocked(fetch).getMockImplementation()
  if (!remote) throw new Error('Missing fixture')
  mockModel({ usage: COMPACT_AFTER_TURN_7 })
  await compactedAgent(test.agentId, 'mcp-pruning')
  vi.mocked(fetch).mockImplementation(remote)
  await exports.default.sendMessage(test.agentId, {
    requestId: 'mcp-before-prune',
    content: 'Read the selected source',
  })
  await waitForAnswer(test.agentId, 'mcp-before-prune')
  expect(test.remoteCalls()).toBe(1)
  const stub = env.AGENTS.getByName(test.agentId)
  const receipt = await runInDurableObject(stub, async (_agent, state) => {
    const local = await openLocalDb(state.storage)
    const receipt = local.select().from(mcpCalls).get()
    if (!receipt) throw new Error('Missing call receipt')
    expect(
      local
        .select()
        .from(piTasks)
        .where(eq(piTasks.id, Number(receipt.callId)))
        .get(),
    ).toMatchObject({ status: 'terminal' })
    // A separate remote response never committed a Pi result.
    beginMcpCall(local, '999999', receipt.runId, 'uncommitted')
    finishMcpCall(local, '999999')
    return receipt
  })
  expect(await stub.prune({ force: true })).toBe('pruned')
  await runInDurableObject(stub, async (_agent, state) => {
    const local = await openLocalDb(state.storage)
    expect(
      local.select().from(mcpCalls).where(eq(mcpCalls.callId, receipt.callId)).get(),
    ).toMatchObject({ state: 'succeeded' })
    expect(
      local
        .select()
        .from(piTasks)
        .where(eq(piTasks.id, Number(receipt.callId)))
        .get(),
    ).toMatchObject({ status: 'terminal' })
    expect(() => beginMcpCall(local, '1000000', receipt.runId, receipt.toolId)).not.toThrow()
    expect(local.select().from(mcpCalls).where(eq(mcpCalls.callId, '999999')).get()).toMatchObject({
      state: 'outcome_unknown',
    })
    expect(() => beginMcpCall(local, '1000001', receipt.runId, 'uncommitted')).toThrow(
      'mcp_retry_requires_new_operator_input',
    )
  })
})

it('reconciles a successful remote response as uncertain before Pi commits its result', async () => {
  const test = await fixture(false, 2)
  const cleanup = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const original = vi.mocked(fetch).getMockImplementation()
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    if (options?.method === 'DELETE') {
      cleanup.resolve()
      await release.promise
    }
    if (!original) throw new Error('Missing fixture')
    return original(url, options)
  })
  await runInDurableObject(env.AGENTS.getByName(test.agentId), (agent) =>
    agent.sendMessage({ requestId: 'mcp-evict-success', content: 'Read the selected source' }),
  )
  await cleanup.promise
  const stub = env.AGENTS.getByName(test.agentId)
  try {
    await runInDurableObject(stub, async (_agent, state) => {
      const local = await openLocalDb(state.storage)
      const receipt = local.select().from(mcpCalls).get()
      expect(receipt?.state).toBe('succeeded')
      if (!receipt) throw new Error('Missing call receipt')
      expect(() => beginMcpCall(local, 'next-call', receipt.runId, receipt.toolId)).toThrow(
        'mcp_retry_requires_new_operator_input',
      )
      // Run the exact startup reconciliation at the persisted pre-settlement boundary.
      interruptMcpCalls(local)
    })
  } finally {
    release.resolve()
  }
  await waitForAnswer(test.agentId, 'mcp-evict-success')
  expect(test.remoteCalls()).toBe(1)
  expect(test.observedOutput()).toContain('mcp_retry_requires_new_operator_input')
  await runInDurableObject(stub, async (_agent, state) => {
    const local = await openLocalDb(state.storage)
    expect(local.select().from(mcpCalls).all()).toMatchObject([{ state: 'outcome_unknown' }])
  })
})

it('keeps a shared credential active when one agent loses its grant during initialization', async () => {
  const test = await fixture(false, 1)
  const otherAgentId = await newAgentId()
  await assignMcp(test.call, env.CREDENTIAL_KEK_V1, {
    serverId: test.server.serverId,
    credentialId: test.credential.credentialId,
    agentId: otherAgentId,
    toolIds: [test.tool.toolId],
    catalogDigest: test.discovered.catalogDigest,
    readOnly: true,
  })
  const initialized = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const original = vi.mocked(fetch).getMockImplementation()
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    if (typeof options?.body === 'string' && options.body.includes('"method":"initialize"')) {
      initialized.resolve()
      await release.promise
    }
    if (!original) throw new Error('Missing fixture')
    return original(url, options)
  })
  await exports.default.sendMessage(test.agentId, {
    requestId: 'mcp-unassigned',
    content: 'Read the selected source',
  })
  await initialized.promise
  await management
    .delete(credentialGrants)
    .where(
      and(
        eq(credentialGrants.agentId, test.agentId),
        eq(credentialGrants.credentialId, test.credential.credentialId),
      ),
    )
  release.resolve()
  await waitForAnswer(test.agentId, 'mcp-unassigned')
  expect(test.remoteCalls()).toBe(0)
  expect(test.observedOutput()).toContain('mcp_assignment_revoked')
  expect(
    await management
      .select()
      .from(credentials)
      .where(eq(credentials.credentialId, test.credential.credentialId))
      .get(),
  ).toMatchObject({ status: 'active', revision: 1 })
  // A separate object still uses the same credential, with its own live grant.
  let otherModelCalls = 0
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    const address = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
    if (address !== test.server.endpoint) {
      return ++otherModelCalls === 1
        ? toolCallResponse({ name: test.tool.modelName, arguments: {} })
        : textResponse('Finished')
    }
    if (!original) throw new Error('Missing fixture')
    return original(url, options)
  })
  await exports.default.sendMessage(otherAgentId, {
    requestId: 'mcp-still-assigned',
    content: 'Read the selected source',
  })
  await waitForAnswer(otherAgentId, 'mcp-still-assigned')
  expect(test.remoteCalls()).toBe(1)
})
