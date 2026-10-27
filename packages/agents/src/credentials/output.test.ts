/** Real RPC, persistence and SSE never see user/provider credential echoes. @module */
import { env, exports } from 'cloudflare:workers'
import { expect, it, vi } from 'vitest'
import { newAgentId } from '../helper/management.ts'
import { modelResponse, rejectionInObject, useMockModel } from '../helper/rpc.ts'
import { toolCallResponse } from '../helper/model.ts'
import '@earendil-works/pi-ai/api/openai-responses'

useMockModel()

it('redacts known assigned values and key patterns before conversations and SSE are written', async () => {
  const id = await newAgentId()
  vi.mocked(globalThis.fetch).mockImplementation(async () =>
    modelResponse('Echo test-key and sk-provider-secret12345'),
  )
  const stream = await exports.default.send(id, {
    requestId: 'redacted-answer',
    content: 'Remember test-key and xai-private123456',
  })
  const events = await new Response(stream).text()
  expect(events).not.toContain('test-key')
  expect(events).not.toContain('sk-provider-secret12345')
  expect(events).not.toContain('xai-private123456')
  expect(events).toContain('[REDACTED]')
  using snapshot = await exports.default.snapshot(id)
  expect(snapshot.snapshot.messages).toEqual([
    expect.objectContaining({ role: 'user', text: 'Remember [REDACTED] and [REDACTED]' }),
    expect.objectContaining({ role: 'assistant', text: 'Echo [REDACTED] and [REDACTED]' }),
  ])
})

it.each(['sk-request00000001', 'test-key'])(
  'rejects credential text in request IDs: %s',
  async (requestId) => {
    const id = await newAgentId()
    const error = await rejectionInObject(env.AGENTS.getByName(id), (agent) =>
      agent.sendMessage({ requestId, content: 'Hello' }),
    )
    expect(error).toContain('requestId must not contain credential text')
    expect(error).not.toContain(requestId)
  },
)

it('removes credential-bearing tool argument keys before persistence and SSE', async () => {
  const id = await newAgentId()
  vi.mocked(globalThis.fetch).mockImplementationOnce(async () =>
    toolCallResponse({
      name: 'unknown_tool',
      arguments: { 'sk-provider-secret12345': 'value', 'test-key': 'opaque' },
    }),
  )
  const events = await new Response(
    await exports.default.send(id, { requestId: 'unsafe-keys', content: 'Hello' }),
  ).text()
  expect(events).not.toContain('sk-provider-secret12345')
  expect(events).not.toContain('test-key')
  using snapshot = await exports.default.snapshot(id)
  expect(JSON.stringify(snapshot)).not.toContain('sk-provider-secret12345')
  expect(JSON.stringify(snapshot)).not.toContain('test-key')
})

it('redacts an opaque credential echoed by a request completing after six minutes', async () => {
  const id = await newAgentId()
  vi.mocked(globalThis.fetch).mockImplementationOnce(async () => {
    const started = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(started + 6 * 60 * 1000)
    return modelResponse('Late response echoes test-key')
  })
  const events = await new Response(
    await exports.default.send(id, { requestId: 'long-request', content: 'Hello' }),
  ).text()
  expect(events).not.toContain('test-key')
  expect(events).toContain('Late response echoes [REDACTED]')
  using snapshot = await exports.default.snapshot(id)
  expect(JSON.stringify(snapshot)).not.toContain('test-key')
})

it('redacts provider error bodies before unanswered details and SSE', async () => {
  const id = await newAgentId()
  vi.mocked(globalThis.fetch).mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          error: { message: 'Invalid test-key sk-rejected123456', type: 'invalid_request_error' },
        }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ),
  )
  const events = await new Response(
    await exports.default.send(id, { requestId: 'redacted-error', content: 'Hello' }),
  ).text()
  expect(events).not.toContain('test-key')
  expect(events).not.toContain('sk-rejected123456')
  using submission = await exports.default.submission(id, 'redacted-error')
  expect(submission?.submission.status).toBe('unanswered')
  expect(JSON.stringify(submission)).not.toContain('test-key')
  expect(JSON.stringify(submission)).not.toContain('sk-rejected123456')
})
