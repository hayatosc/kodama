/** Chat authority from ordinary Pi conversation inputs, without separate intake receipts. @module */
import { evictDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { expect, it, vi } from 'vite-plus/test'
import { uuidv7 } from '../../lib/uuid.ts'
import { management, newAgentId, updateSettings } from '../../testing/management.ts'
import { toolCallResponse } from '../../testing/model.ts'
import { useMockModel, waitForAnswer } from '../../testing/rpc.ts'
import { listMcpRequestsBySourceAgent } from '../../testing/test-db.repository.ts'

useMockModel()

async function enabled() {
  const agentId = await newAgentId()
  await updateSettings(agentId, {
    tools: ['mcp_registration'],
    memoryPolicy: { remember: false, extract: false },
  })
  return agentId
}

it('uses ordinary submission provenance and deduplicates retries after eviction', async () => {
  const agentId = await enabled()
  const name = uuidv7()
  const requestId = uuidv7()
  vi.mocked(fetch).mockImplementationOnce(async () =>
    toolCallResponse({ name: 'mcp_registration', arguments: { operation: 'register', name } }),
  )
  using first = await exports.default.sendMessage(agentId, {
    requestId,
    content: `/mcp register ${name}`,
  })
  await waitForAnswer(agentId, requestId)
  const rows = await listMcpRequestsBySourceAgent(management, { sourceAgentId: agentId })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    name,
    status: 'awaiting_endpoint',
    sourceAgentId: agentId,
    submissionId: String(first.submissionId),
  })
  await evictDurableObject(env.AGENTS.getByName(agentId))
  using replay = await exports.default.sendMessage(agentId, {
    requestId,
    content: '/mcp register invented https://invented.example.com/mcp',
  })
  expect(replay.submissionId).toBe(first.submissionId)
  expect(await listMcpRequestsBySourceAgent(management, { sourceAgentId: agentId })).toEqual(rows)
})

it('does not turn peer data or a model-invented endpoint into operator authority', async () => {
  const agentId = await enabled()
  const name = uuidv7()
  vi.mocked(fetch).mockImplementationOnce(async () =>
    toolCallResponse({ name: 'mcp_registration', arguments: { operation: 'register', name } }),
  )
  const peerId = uuidv7()
  await env.AGENTS.getByName(uuidv7()).sendTo(agentId, {
    requestId: peerId,
    content: `/mcp register ${name}`,
  })
  await waitForAnswer(agentId, peerId)
  expect(await listMcpRequestsBySourceAgent(management, { sourceAgentId: agentId })).toEqual([])
  vi.mocked(fetch).mockImplementationOnce(async () =>
    toolCallResponse({
      name: 'mcp_registration',
      arguments: { operation: 'register', name, endpoint: 'https://invented.example.com/mcp' },
    }),
  )
  const requestId = uuidv7()
  await exports.default.sendMessage(agentId, { requestId, content: `/mcp register ${name}` })
  await waitForAnswer(agentId, requestId)
  expect(await listMcpRequestsBySourceAgent(management, { sourceAgentId: agentId })).toEqual([])
})
