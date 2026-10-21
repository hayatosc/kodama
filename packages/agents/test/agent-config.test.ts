import { evictDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { modelResponse, useMockModel, waitForAnswer } from './helpers/rpc.ts'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'

useMockModel()

describe('agent configuration', () => {
  it('persists independent agent configuration and applies it to subsequent model requests', async () => {
    const agentId = crypto.randomUUID()
    using original = await exports.default.getConfig(agentId)
    const updated = {
      ...original,
      model: { provider: 'openai', modelId: 'gpt-6-sol' },
      systemPrompt: 'You are a research assistant. Cite evidence.',
      thinkingLevel: 'low' as const,
      tools: ['current_time'],
    }
    await exports.default.setConfig(agentId, updated)
    using other = await exports.default.getConfig(crypto.randomUUID())
    expect(other).toEqual(original)
    const stub = env.AGENTS.getByName(agentId)
    await evictDurableObject(stub)
    expect(await exports.default.getConfig(agentId)).toEqual(updated)
    await exports.default.sendMessage(agentId, { requestId: 'configured', content: 'Hello' })
    await waitForAnswer(agentId, 'configured')
    const body = vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body
    expect(typeof body).toBe('string')
    if (typeof body !== 'string') throw new Error('Missing model request body')
    expect(body).toContain('gpt-6-sol')
    expect(body).toContain(updated.systemPrompt)
    expect(body).toContain('current_time')
    expect(body).not.toContain(original.systemPrompt)
    await expect
      .poll(async () => (await exports.default.snapshot(agentId)).snapshot.busy)
      .toBe(false)
    await exports.default.setConfig(agentId, { ...updated, tools: [], systemPrompt: '' })
    await exports.default.sendMessage(agentId, { requestId: 'disabled', content: 'Again' })
    await waitForAnswer(agentId, 'disabled')
    const nextBody = vi.mocked(globalThis.fetch).mock.calls[1]?.[1]?.body
    if (typeof nextBody !== 'string') throw new Error('Missing second model request body')
    // Deselecting every configurable tool leaves only the long-term memory tools.
    expect(nextBody).not.toContain('current_time')
    expect(nextBody).toContain('memory_search')
    expect(nextBody).toContain('remember')
    expect(
      (await exports.default.snapshot(agentId)).snapshot.messages.filter((m) => m.role === 'user'),
    ).toHaveLength(2)
  })

  it('rejects invalid configuration without changing the stored configuration', async () => {
    const agentId = crypto.randomUUID()
    using original = await exports.default.getConfig(agentId)
    for (const invalid of [
      { ...original, model: { provider: 'unknown', modelId: 'unknown' } },
      { ...original, tools: ['unknown_tool'] },
      { ...original, tools: ['current_time', 'current_time'] },
      { ...original, systemPrompt: 'x'.repeat(64_001) },
    ]) {
      await expect(Promise.resolve(exports.default.setConfig(agentId, invalid))).rejects.toThrow()
      expect(await exports.default.getConfig(agentId)).toEqual(original)
    }
  })

  it('rejects configuration changes while a generation is active', async () => {
    const agentId = crypto.randomUUID()
    using original = await exports.default.getConfig(agentId)
    const started = Promise.withResolvers<void>()
    const response = Promise.withResolvers<Response>()
    vi.mocked(globalThis.fetch).mockImplementationOnce(async () => {
      started.resolve()
      return response.promise
    })
    await exports.default.sendMessage(agentId, { requestId: 'busy', content: 'Wait' })
    await started.promise
    try {
      await expect(
        Promise.resolve(
          exports.default.setConfig(agentId, { ...original, systemPrompt: 'Changed' }),
        ),
      ).rejects.toThrow('busy')
      expect(await exports.default.getConfig(agentId)).toEqual(original)
    } finally {
      response.resolve(modelResponse())
    }
    await waitForAnswer(agentId, 'busy')
  })
})

it('switches providers over RPC and keeps the selection after eviction', async () => {
  const agentId = crypto.randomUUID()
  const initial = await exports.default.getConfig(agentId)
  await exports.default.sendMessage(agentId, { requestId: 'openai', content: 'Hello' })
  await waitForAnswer(agentId, 'openai')
  await expect.poll(async () => (await exports.default.snapshot(agentId)).snapshot.busy).toBe(false)
  await exports.default.setConfig(agentId, {
    ...initial,
    model: { provider: 'xai', modelId: 'grok-4.3' },
  })
  await evictDurableObject(env.AGENTS.getByName(agentId))
  expect((await exports.default.getConfig(agentId)).model).toEqual({
    provider: 'xai',
    modelId: 'grok-4.3',
  })
  vi.mocked(fetch).mockClear()
  await exports.default.sendMessage(agentId, { requestId: 'xai', content: 'Continue' })
  await waitForAnswer(agentId, 'xai')
  const call = vi.mocked(fetch).mock.calls.at(-1)
  if (!call) throw new Error('Expected a model request')
  const request = new Request(call[0], call[1])
  expect(request.url).toBe('https://api.x.ai/v1/responses')
  expect(request.headers.get('authorization')).toBe('Bearer xai-test-key')
  expect(await request.json()).toMatchObject({ model: 'grok-4.3' })
  const state = await exports.default.snapshot(agentId)
  expect(state.snapshot.messages.filter((message) => message.role === 'user')).toHaveLength(2)
})
