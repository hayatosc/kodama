/** Provider content and request identities pass through without credential redaction. @module */
import { env, exports } from 'cloudflare:workers'
import { expect, it, vi } from 'vitest'
import { newAgentId } from '../testing/management.ts'
import { modelResponse, useMockModel, waitForAnswer } from '../testing/rpc.ts'
import { requestBody, toolCallResponse, toolResults } from '../testing/model.ts'
import { currentTimeTool } from '../tools/current-time.ts'

useMockModel()

it('preserves provider and user text in persistence and SSE, even when it matches a credential', async () => {
  const id = await newAgentId()
  const text = 'risk-assessment task-oriented xai-based-systems sk-provider123456 test-key'
  vi.mocked(globalThis.fetch).mockImplementation(async () => modelResponse(text))
  const events = await new Response(
    await exports.default.send(id, { requestId: 'unchanged-output', content: text }),
  ).text()
  expect(events).toContain(text)
  using snapshot = await exports.default.snapshot(id)
  expect(snapshot.snapshot.messages).toEqual([
    expect.objectContaining({ role: 'user', text }),
    expect.objectContaining({ role: 'assistant', text }),
  ])
})

it.each(['test-key', 'sk-request00000001', 'xai-request00000001'])(
  'preserves request ID identity for retries and lookup: %s',
  async (requestId) => {
    const id = await newAgentId()
    vi.mocked(globalThis.fetch).mockImplementation(async () => modelResponse('Hello'))
    const agent = env.AGENTS.getByName(id)
    const first = await agent.sendMessage({ requestId, content: 'Hello' })
    expect(await agent.sendMessage({ requestId, content: 'Hello' })).toBe(first)
    using submission = await exports.default.submission(id, requestId)
    expect(submission?.submission).toMatchObject({ id: first, requestId })
  },
)

it('preserves tool argument keys rather than guessing whether they contain credentials', async () => {
  const id = await newAgentId()
  vi.mocked(globalThis.fetch).mockImplementationOnce(async () =>
    toolCallResponse({ name: 'unknown_tool', arguments: { 'test-key': 'value' } }),
  )
  const events = await new Response(
    await exports.default.send(id, { requestId: 'unchanged-keys', content: 'Hello' }),
  ).text()
  expect(events).toContain('test-key')
})

it('does not run a registered tool that the applied version does not enable', async () => {
  const id = await newAgentId()
  const execute = vi.spyOn(currentTimeTool, 'execute')
  let calls = 0
  vi.mocked(globalThis.fetch).mockImplementation(async () =>
    calls++ === 0
      ? toolCallResponse({ name: 'current_time', arguments: {} })
      : modelResponse('Done'),
  )

  await exports.default.sendMessage(id, { requestId: 'disabled-tool', content: 'Time?' })
  await waitForAnswer(id, 'disabled-tool')

  expect(execute).not.toHaveBeenCalled()
  // The model is told the call failed rather than left waiting for it.
  expect(toolResults(requestBody(vi.mocked(globalThis.fetch).mock.calls[1]?.[1]))).toBe(1)
})
