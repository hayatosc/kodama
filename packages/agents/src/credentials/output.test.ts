/** Real RPC, persistence and SSE never see user/provider credential echoes. @module */
import { exports } from 'cloudflare:workers'
import { expect, it, vi } from 'vitest'
import { newAgentId } from '../helper/management.ts'
import { modelResponse, useMockModel } from '../helper/rpc.ts'
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
