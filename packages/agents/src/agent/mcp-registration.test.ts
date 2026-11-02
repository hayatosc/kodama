/** Chat authority through real Pi runs, owner intake receipts and object SQLite. @module */
import { exports } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { expect, it, vi } from 'vitest'
import { mcpRequests } from '../../drizzle/management/schema.ts'
import { management, newAgentId, updateSettings } from '../testing/management.ts'
import { useMockModel, waitForAnswer } from '../testing/rpc.ts'
import { toolCallResponse } from '../testing/model.ts'
import { uuidv7 } from '../lib/uuid.ts'

useMockModel()

async function enabled() {
  const agentId = await newAgentId()
  await updateSettings(agentId, {
    tools: ['mcp_registration'],
    memoryPolicy: { remember: false, extract: false },
  })
  return agentId
}

it('accepts the exact authenticated owner instruction and records its real source', async () => {
  const agentId = await enabled()
  const name = uuidv7()
  const requestId = uuidv7()
  vi.mocked(fetch).mockImplementationOnce(async () =>
    toolCallResponse({ name: 'mcp_registration', arguments: { operation: 'register', name } }),
  )
  await exports.default.ownerReply(agentId, {
    requestId,
    externalMessageId: uuidv7(),
    sequence: 1,
    action: 'followUp',
    content: `/mcp register ${name}`,
  })
  await waitForAnswer(agentId, requestId)
  const rows = await management
    .select()
    .from(mcpRequests)
    .where(eq(mcpRequests.sourceAgentId, agentId))
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ name, status: 'awaiting_endpoint', sourceAgentId: agentId })
})

it('does not turn a legacy user message or model-invented endpoint into owner authority', async () => {
  const agentId = await enabled()
  const name = uuidv7()
  vi.mocked(fetch).mockImplementationOnce(async () =>
    toolCallResponse({ name: 'mcp_registration', arguments: { operation: 'register', name } }),
  )
  const legacyId = uuidv7()
  await exports.default.sendMessage(agentId, {
    requestId: legacyId,
    content: `/mcp register ${name}`,
  })
  await waitForAnswer(agentId, legacyId)
  expect(
    await management.select().from(mcpRequests).where(eq(mcpRequests.sourceAgentId, agentId)),
  ).toEqual([])
  vi.mocked(fetch).mockImplementationOnce(async () =>
    toolCallResponse({
      name: 'mcp_registration',
      arguments: { operation: 'register', name, endpoint: 'https://invented.example.com/mcp' },
    }),
  )
  const requestId = uuidv7()
  await exports.default.ownerReply(agentId, {
    requestId,
    externalMessageId: uuidv7(),
    sequence: 1,
    action: 'followUp',
    content: `/mcp register ${name}`,
  })
  await waitForAnswer(agentId, requestId)
  expect(
    await management.select().from(mcpRequests).where(eq(mcpRequests.sourceAgentId, agentId)),
  ).toEqual([])
})
