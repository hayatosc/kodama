/** Provider content and request identities pass through without credential redaction. @module */
import { runInDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/durable-sqlite'
import { expect, it, vi } from 'vitest'
import { piEntries } from './local-db/pi-tables.ts'
import { newAgentId, updateSettings } from '../testing/management.ts'
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

it('executes opted-in code through the real agent tool loop', async () => {
  const id = await newAgentId()
  await updateSettings(id, {
    tools: ['execute_code'],
    memoryPolicy: { remember: true, extract: false },
  })
  vi.mocked(fetch).mockImplementationOnce(async () =>
    toolCallResponse({
      name: 'execute_code',
      arguments: {
        code: 'export default (input: number[]) => ({ total: input.reduce((a, b) => a + b, 0) })',
        input: [20, 22],
      },
    }),
  )
  await exports.default.sendMessage(id, { requestId: 'code-enabled', content: 'Add these numbers' })
  await waitForAnswer(id, 'code-enabled')
  expect(JSON.parse(requestBody(vi.mocked(fetch).mock.calls[1]?.[1]))).toMatchObject({
    input: expect.arrayContaining([
      expect.objectContaining({
        type: 'function_call_output',
        output: expect.stringContaining('{"total":42}'),
      }),
    ]),
  })
})

it.each([
  { name: 'ASCII', text: 'x', count: 3 * 1024 * 1024 },
  { name: 'multibyte', text: 'あ', count: 1024 * 1024 },
  { name: 'JSON-escaped', text: '\u0000', count: 512 * 1024 },
])(
  'bounds $name code output before SQLite persistence using Pi defaults',
  async ({ text, count }) => {
    const id = await newAgentId()
    await updateSettings(id, {
      tools: ['execute_code'],
      memoryPolicy: { remember: true, extract: false },
    })
    // Each generated response exceeds the platform's 2 MiB SQLite row limit before Pi bounds it.
    expect(new TextEncoder().encode(JSON.stringify(text.repeat(count))).byteLength).toBeGreaterThan(
      2 * 1024 * 1024,
    )
    vi.mocked(fetch).mockImplementationOnce(async () =>
      toolCallResponse({
        name: 'execute_code',
        arguments: {
          code: 'export default ({ text, count }) => text.repeat(count)',
          input: { text, count },
        },
      }),
    )
    await exports.default.sendMessage(id, { requestId: 'large-code-output', content: 'Run code' })
    await waitForAnswer(id, 'large-code-output')
    expect(JSON.parse(requestBody(vi.mocked(fetch).mock.calls[1]?.[1]))).toMatchObject({
      input: expect.arrayContaining([
        expect.objectContaining({
          type: 'function_call_output',
          output: expect.stringContaining('Output truncated'),
        }),
      ]),
    })
    const rows = await runInDurableObject(env.AGENTS.getByName(id), (_instance, state) =>
      drizzle(state.storage).select({ record: piEntries.record }).from(piEntries).all(),
    )
    const result = rows.find((row) => row.record.includes('"kind":"pi.tool-result"'))
    expect(result).toBeDefined()
    if (!result) throw new Error('Missing persisted tool result')
    expect(new TextEncoder().encode(result.record).byteLength).toBeLessThan(2 * 1024 * 1024)
    expect(JSON.parse(result.record)).toMatchObject({
      model: [expect.objectContaining({ toolName: 'execute_code', isError: false })],
      data: { diagnostics: [expect.objectContaining({ code: 'truncated', severity: 'warn' })] },
    })
  },
)

it.each(['disabled', 'denied'] as const)(
  'refuses %s code execution through the agent tool loop',
  async (mode) => {
    const id = await newAgentId()
    await updateSettings(id, {
      tools: mode === 'disabled' ? [] : ['execute_code'],
      toolPolicy: mode === 'denied' ? { execute_code: 'deny' } : {},
      memoryPolicy: { remember: true, extract: false },
    })
    vi.mocked(fetch).mockImplementationOnce(async () =>
      toolCallResponse({
        name: 'execute_code',
        arguments: { code: 'export default () => "should not run"' },
      }),
    )
    await exports.default.sendMessage(id, { requestId: 'code-refused', content: 'Run code' })
    await waitForAnswer(id, 'code-refused')
    expect(JSON.parse(requestBody(vi.mocked(fetch).mock.calls[1]?.[1]))).toMatchObject({
      input: expect.arrayContaining([
        expect.objectContaining({
          type: 'function_call_output',
          output: expect.stringContaining(
            mode === 'disabled'
              ? 'Tool execute_code is not available'
              : 'tool execute_code is denied',
          ),
        }),
      ]),
    })
  },
)
