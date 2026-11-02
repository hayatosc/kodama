/** Pinned dynamic MCP tools through real Durable Object execution and eviction. @module */
import { env, exports } from 'cloudflare:workers'
import { evictDurableObject, runInDurableObject } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { expect, it, vi } from 'vitest'
import { principals } from '../../drizzle/management/schema.ts'
import { mcpCalls } from '../../drizzle/durable-object/schema.ts'
import { caller, management, newAgentId, principalIdOf } from '../testing/management.ts'
import { useMockModel, waitForAnswer } from '../testing/rpc.ts'
import { textResponse, toolCallResponse } from '../testing/model.ts'
import { registerMcpCatalog } from '../control-plane/mcp.ts'
import { createAgentModels } from '../control-plane/models.ts'
import { assignMcp, discoverMcp } from '../control-plane/workflows/mcp.ts'
import { putMcpBearer } from '../credentials/mcp-vault.ts'
import { disconnectMcp } from '../credentials/mcp-refresh.ts'
import { MCP_PROTOCOL } from '../tools/mcp/transport.ts'
import { uuidv7 } from '../lib/uuid.ts'
import { openLocalDb } from './local-db/local.ts'

useMockModel()

async function fixture(failure = false) {
  const agentId = await newAgentId()
  const principalId = await principalIdOf(await caller())
  const principal = await management
    .select()
    .from(principals)
    .where(eq(principals.principalId, principalId))
    .get()
  if (!principal) throw new Error('Missing owner')
  const call = { env, db: management, models: createAgentModels(), principal, now: Date.now() }
  const endpoint = `https://${uuidv7()}.example.com/mcp`
  const server = await registerMcpCatalog(management, principalId, 'runtime', endpoint, call.now)
  const credential = await putMcpBearer(
    management,
    env.CREDENTIAL_KEK_V1,
    principalId,
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
      if (modelCalls <= (failure ? 2 : 1))
        return toolCallResponse({ name: modelName, arguments: {} })
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
    return Response.json({ jsonrpc: '2.0', id: value.id, result })
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
    principalId,
    server,
    credential,
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
    test.principalId,
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
