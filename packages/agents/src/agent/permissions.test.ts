/**
 * Non-blocking deferred tool approvals, auto-mode risk classification, and write-capable MCP
 * gating through real Durable Object execution.
 *
 * @module
 */
import { runInDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vite-plus/test'
import { deferredCalls as deferredCallsTable } from '../../drizzle/durable-object/schema.ts'
import { createAgentModels } from '../control-plane/models.ts'
import { MCP_PROTOCOL } from '../mcp/connection/transport.ts'
import { putMcpBearer } from '../mcp/authorization/vault.ts'
import { registerMcpCatalog } from '../mcp/registration/catalog.ts'
import { manageMcp } from '../mcp/registration/operations.ts'
import { discoverMcp } from '../mcp/registration/servers.ts'
import { uuidv7 } from '../lib/uuid.ts'
import { management, newAgentId, updateSettings } from '../testing/management.ts'
import { requestBody, textResponse, toolCallResponse } from '../testing/model.ts'
import { useMockModel, waitForAnswer } from '../testing/rpc.ts'
import { openLocalDb } from './local-db/local.ts'
import { classifyToolRisk, stableArgsJson } from './permissions.ts'
import { setAlarm } from './runtime/alarms.ts'
import '@earendil-works/pi-ai/api/openai-responses'

useMockModel()

async function wakeInbox(id: string) {
  await runInDurableObject(env.AGENTS.getByName(id), async (instance, state) => {
    await setAlarm(state.storage, 'inbox', Date.now() - 1)
    await instance.alarm()
  })
}

describe('tool permissions and deferred approvals', () => {
  it('classifies tool risk and canonicalizes JSON arguments deterministically', () => {
    expect(classifyToolRisk('current_time', {})).toBe('low')
    expect(classifyToolRisk('web_search', { query: 'status' })).toBe('low')
    expect(classifyToolRisk('task_write', { slug: 'a' })).toBe('low')
    expect(classifyToolRisk('send_outbox', { summary: 'alert' })).toBe('low')
    expect(classifyToolRisk('skill_read', { name: 'ops' })).toBe('low')

    expect(classifyToolRisk('execute_code', { code: '1+1' })).toBe('high')
    expect(classifyToolRisk('create_artifact', { filename: 'a.txt', content: 'hi' })).toBe('high')
    expect(classifyToolRisk('delete_artifact', { artifactId: '1' })).toBe('high')
    expect(classifyToolRisk('contact_agent', { target: 'peer', message: 'hi' })).toBe('high')
    expect(classifyToolRisk('schedule_task', { intervalSeconds: 60 })).toBe('high')

    expect(classifyToolRisk('mcp_aaa_bbb', {}, true)).toBe('low')
    expect(classifyToolRisk('mcp_aaa_bbb', {}, false)).toBe('high')
    expect(classifyToolRisk('mcp_aaa_bbb', {})).toBe('high')
    expect(classifyToolRisk('unknown_future_tool', {})).toBe('high')

    expect(stableArgsJson({ b: 2, a: { y: 2, x: 1, z: undefined } })).toBe(
      stableArgsJson({ a: { x: 1, y: 2 }, b: 2 }),
    )
  })

  it('defers ask-gated calls non-blockingly, keeps Q&A responsive, and consumes approval once', async () => {
    const id = await newAgentId()
    await updateSettings(id, {
      memoryPolicy: { remember: true, extract: false },
      tools: ['current_time', 'create_artifact', 'list_artifacts'],
      toolPolicy: { create_artifact: 'ask' },
    })

    let observedDeferredOutput = ''
    vi.mocked(fetch)
      .mockImplementationOnce(async () =>
        toolCallResponse({
          name: 'create_artifact',
          arguments: { filename: 'note.txt', content: 'approved payload' },
        }),
      )
      .mockImplementationOnce(async (_input, init) => {
        observedDeferredOutput = requestBody(init)
        return textResponse('Waiting for operator approval on create_artifact.')
      })

    await exports.default.sendMessage(id, {
      requestId: 'req-create',
      content: 'Save note.txt with approved payload.',
    })
    await waitForAnswer(id, 'req-create')

    expect(observedDeferredOutput).toContain('\\"status\\":\\"deferred\\"')
    expect(observedDeferredOutput).toContain('\\"toolName\\":\\"create_artifact\\"')

    using initialArtifacts = await exports.default.listArtifacts(id, {})
    expect(initialArtifacts).toHaveLength(0)

    const listed = await exports.default.deferredCalls(id)
    expect(listed).toHaveLength(1)
    const pending = listed[0]
    if (!pending) throw new Error('Expected pending deferred call')
    expect(pending.state).toBe('pending')
    expect(pending.toolName).toBe('create_artifact')

    using attn = await exports.default.attention(id)
    expect(attn).toContainEqual({
      source: 'approval',
      id: pending.approvalId,
      reason: pending.reason,
      lastProgressAt: pending.createdAt,
      actions: ['approve', 'deny'],
      toolName: 'create_artifact',
    })

    using notices = await exports.default.notifications(id, {})
    expect(
      notices.notifications.some(
        (item) => item.source === 'approval' && item.sourceId === pending.approvalId,
      ),
    ).toBe(true)

    // Unrelated chat stays responsive while approval is still pending.
    vi.mocked(fetch).mockImplementationOnce(async () => textResponse('Normal Q&A works fine.'))
    await exports.default.sendMessage(id, {
      requestId: 'req-unrelated',
      content: 'What is 2 + 2?',
    })
    await waitForAnswer(id, 'req-unrelated')
    using snap = await exports.default.snapshot(id)
    expect(snap.snapshot.messages.at(-1)?.text).toContain('Normal Q&A works fine.')

    // Operator approves; inbox wakes the agent to execute the exact approved call once.
    const resolved = await exports.default.resolveDeferredCall(id, {
      approvalId: pending.approvalId,
      decision: 'approve',
      note: 'Verified safe',
    })
    expect(resolved.state).toBe('approved')
    expect(resolved.resumeEventId).toBeTruthy()

    vi.mocked(fetch)
      .mockImplementationOnce(async (_input, init) => {
        expect(requestBody(init)).toContain('Verified safe')
        return toolCallResponse({
          name: 'create_artifact',
          arguments: { content: 'approved payload', filename: 'note.txt' },
        })
      })
      .mockImplementationOnce(async (_input, init) => {
        const body = requestBody(init)
        expect(body).toContain('note.txt')
        expect(body).toContain('\\"artifactId\\":')
        return textResponse('Created note.txt after approval.')
      })

    await wakeInbox(id)
    await waitForAnswer(id, `approval-${pending.approvalId}-approve`)

    using afterApprove = await exports.default.listArtifacts(id, {})
    expect(afterApprove).toHaveLength(1)
    expect(afterApprove[0]?.filename).toBe('note.txt')

    const afterList = await exports.default.deferredCalls(id)
    expect(afterList[0]?.state).toBe('consumed')

    // Repeating the same call requires a fresh approval (single-use consumption).
    vi.mocked(fetch)
      .mockImplementationOnce(async () =>
        toolCallResponse({
          name: 'create_artifact',
          arguments: { filename: 'note.txt', content: 'approved payload' },
        }),
      )
      .mockImplementationOnce(async () => textResponse('Needs new approval.'))

    await exports.default.sendMessage(id, {
      requestId: 'req-second-call',
      content: 'Save another copy.',
    })
    await waitForAnswer(id, 'req-second-call')
    expect(await exports.default.deferredCalls(id)).toHaveLength(2)
  })

  it('handles operator denial and expired approvals without executing the gated tool', async () => {
    const id = await newAgentId()
    await updateSettings(id, {
      memoryPolicy: { remember: true, extract: false },
      tools: ['create_artifact'],
      toolPolicy: { create_artifact: 'ask' },
    })

    vi.mocked(fetch)
      .mockImplementationOnce(async () =>
        toolCallResponse({
          name: 'create_artifact',
          arguments: { filename: 'denied.txt', content: 'secret' },
        }),
      )
      .mockImplementationOnce(async () => textResponse('Queued approval.'))

    await exports.default.sendMessage(id, {
      requestId: 'req-deny',
      content: 'Create denied.txt',
    })
    await waitForAnswer(id, 'req-deny')

    const call = (await exports.default.deferredCalls(id))[0]
    if (!call) throw new Error('Expected deferred call')

    const denied = await exports.default.resolveDeferredCall(id, {
      approvalId: call.approvalId,
      decision: 'deny',
      note: 'Do not write this file',
    })
    expect(denied.state).toBe('denied')

    vi.mocked(fetch).mockImplementationOnce(async (_input, init) => {
      expect(requestBody(init)).toContain('Do NOT invoke create_artifact')
      expect(requestBody(init)).toContain('Do not write this file')
      return textResponse('Understood, skipped creating denied.txt.')
    })
    await wakeInbox(id)
    await waitForAnswer(id, `approval-${call.approvalId}-deny`)

    using artifacts = await exports.default.listArtifacts(id, {})
    expect(artifacts).toHaveLength(0)

    // Expired rows return state: 'expired' and do not queue execution.
    await runInDurableObject(env.AGENTS.getByName(id), async (_instance, state) => {
      const local = await openLocalDb(state.storage)
      local
        .insert(deferredCallsTable)
        .values({
          approvalId: '01950000-0000-7000-8000-000000000099',
          toolName: 'create_artifact',
          argumentsJson: '{}',
          reason: 'Old request',
          sourceTask: 'expired-task',
          state: 'pending',
          createdAt: 1000,
          expiresAt: 2000,
        })
        .run()
    })
    const expiredResult = await exports.default.resolveDeferredCall(id, {
      approvalId: '01950000-0000-7000-8000-000000000099',
      decision: 'approve',
    })
    expect(expiredResult).toEqual({
      approvalId: '01950000-0000-7000-8000-000000000099',
      state: 'expired',
    })
  })

  it('auto mode runs low-risk tools automatically while deferring high-risk tools', async () => {
    const id = await newAgentId()
    await updateSettings(id, {
      memoryPolicy: { remember: true, extract: false },
      tools: ['current_time', 'delete_artifact'],
      toolPolicy: { current_time: 'auto', delete_artifact: 'auto' },
    })

    let timeOutput = ''
    let deleteOutput = ''
    vi.mocked(fetch)
      .mockImplementationOnce(async () => toolCallResponse({ name: 'current_time', arguments: {} }))
      .mockImplementationOnce(async (_input, init) => {
        timeOutput = requestBody(init)
        return toolCallResponse({ name: 'delete_artifact', arguments: { artifactId: 'missing-1' } })
      })
      .mockImplementationOnce(async (_input, init) => {
        deleteOutput = requestBody(init)
        return textResponse('Checked time and deferred deletion.')
      })

    await exports.default.sendMessage(id, {
      requestId: 'req-auto',
      content: 'Check time then delete missing-1.',
    })
    await waitForAnswer(id, 'req-auto')

    expect(timeOutput).not.toContain('\\"status\\":\\"deferred\\"')
    expect(deleteOutput).toContain('\\"status\\":\\"deferred\\"')
    expect(deleteOutput).toContain('\\"toolName\\":\\"delete_artifact\\"')

    const calls = await exports.default.deferredCalls(id)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.toolName).toBe('delete_artifact')
  })

  it('gates write-capable MCP assignments (readOnly: false) until approved, even under auto policy', async () => {
    const id = await newAgentId()
    await updateSettings(id, { memoryPolicy: { remember: false, extract: false } })

    const endpoint = `https://${uuidv7()}.example.com/mcp`
    const server = await registerMcpCatalog(management, 'writer', endpoint, Date.now())
    const credential = await putMcpBearer(management, env.CREDENTIAL_KEK_V1, server.serverId, 'tok')
    const call = {
      env,
      db: management,
      models: createAgentModels(),
      source: 'operator' as const,
      now: Date.now(),
    }

    let remoteExecutions = 0
    vi.mocked(fetch).mockImplementation(async (url, options) => {
      const address = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
      if (address !== endpoint) return textResponse('unused')
      if (options?.method === 'DELETE') return new Response(null, { status: 204 })
      const body: unknown = JSON.parse(typeof options?.body === 'string' ? options.body : '{}')
      if (!body || typeof body !== 'object' || !('method' in body))
        throw new Error('Unexpected MCP')
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
      if (!('id' in body)) throw new Error('Missing JSON-RPC id')
      let result: unknown = { protocolVersion: MCP_PROTOCOL, capabilities: { tools: {} } }
      if (body.method === 'tools/list') {
        result = {
          tools: [
            {
              name: 'create_issue',
              inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
            },
          ],
        }
      }
      if (body.method === 'tools/call') {
        remoteExecutions++
        result = { content: [{ type: 'text', text: 'Issue #42 created' }] }
      }
      return Response.json(
        { jsonrpc: '2.0', id: body.id, result },
        { headers: { 'Mcp-Session-Id': 'mcp-write-sess' } },
      )
    })

    const discovered = await discoverMcp(
      call,
      env.CREDENTIAL_KEK_V1,
      server.serverId,
      credential.credentialId,
    )
    const mcpTool = discovered.tools[0]
    if (!mcpTool) throw new Error('Missing MCP tool')

    await manageMcp(call, env.CREDENTIAL_KEK_V1, '', {
      operation: 'assign',
      serverId: server.serverId,
      credentialId: credential.credentialId,
      agentId: id,
      toolIds: [mcpTool.toolId],
      catalogDigest: discovered.catalogDigest,
      readOnly: false,
    })

    // Verify write-capable MCP is automatically gated as 'ask' and deferred before remote execution.
    const savedMock = vi.mocked(fetch).getMockImplementation()
    vi.mocked(fetch).mockImplementation(async (url, options) => {
      const address = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
      if (address === endpoint && savedMock) return savedMock(url, options)
      return textResponse('fallback')
    })

    let firstRoundToolCount = 0
    vi.mocked(fetch).mockImplementation(async (url, options) => {
      const address = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
      if (address === endpoint && savedMock) return savedMock(url, options)
      firstRoundToolCount++
      if (firstRoundToolCount === 1) {
        return toolCallResponse({ name: mcpTool.modelName, arguments: { title: 'Fix outage' } })
      }
      return textResponse('Awaiting MCP write approval.')
    })

    await exports.default.sendMessage(id, {
      requestId: 'mcp-write-1',
      content: 'Open an issue titled Fix outage.',
    })
    await waitForAnswer(id, 'mcp-write-1')
    expect(remoteExecutions).toBe(0)

    // Switching toolPolicy[mcpTool] to 'auto' still keeps write-capable MCP classified as high risk.
    await updateSettings(id, {
      toolPolicy: { [mcpTool.modelName]: 'auto' },
    })

    let autoAttemptCalls = 0
    vi.mocked(fetch).mockImplementation(async (url, options) => {
      const address = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
      if (address === endpoint && savedMock) return savedMock(url, options)
      autoAttemptCalls++
      if (autoAttemptCalls === 1) {
        return toolCallResponse({ name: mcpTool.modelName, arguments: { title: 'Second issue' } })
      }
      return textResponse('Still deferred under auto mode.')
    })
    await exports.default.sendMessage(id, {
      requestId: 'mcp-write-auto',
      content: 'Open Second issue.',
    })
    await waitForAnswer(id, 'mcp-write-auto')
    expect(remoteExecutions).toBe(0)
    expect(await exports.default.deferredCalls(id)).toHaveLength(2)

    const deferred = (await exports.default.deferredCalls(id)).find((item) =>
      item.argumentsJson.includes('Fix outage'),
    )
    if (!deferred) throw new Error('Expected MCP approval')

    await exports.default.resolveDeferredCall(id, {
      approvalId: deferred.approvalId,
      decision: 'approve',
    })

    let secondRoundModelCalls = 0
    let observedMcpOutput = ''
    vi.mocked(fetch).mockImplementation(async (url, options) => {
      const address = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
      if (address === endpoint && savedMock) return savedMock(url, options)
      secondRoundModelCalls++
      if (secondRoundModelCalls === 1) {
        return toolCallResponse({ name: mcpTool.modelName, arguments: { title: 'Fix outage' } })
      }
      observedMcpOutput = requestBody(options)
      return textResponse('Issue created via MCP.')
    })

    await wakeInbox(id)
    await waitForAnswer(id, `approval-${deferred.approvalId}-approve`)
    expect(remoteExecutions).toBe(1)
    expect(observedMcpOutput).toContain('Issue #42 created')
  })
})
