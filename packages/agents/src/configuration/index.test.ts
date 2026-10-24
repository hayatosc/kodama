import { describe, expect, it, vi } from 'vitest'
import { agentSettingsSchema, defaultAgentSettings } from './index.ts'
import { createAgentModels } from '../models/index.ts'
import { parseInput } from '../validation.ts'
import { evictDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { useMockModel, waitForAnswer } from '../helper/rpc.ts'
import { management, desiredSettings, newAgentId, updateSettings } from '../helper/management.ts'
import { agentConfigVersions } from '../../drizzle/management/schema.ts'
import { eq } from 'drizzle-orm'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'

const schema = agentSettingsSchema(createAgentModels({}))
const valid = defaultAgentSettings({
  DEFAULT_MODEL_PROVIDER: 'openai',
  DEFAULT_MODEL_ID: 'gpt-6-luna',
})
const credentialId = crypto.randomUUID()

describe('agent settings schema', () => {
  it('accepts complete settings with every optional field in its one shape', () => {
    const settings = {
      ...valid,
      thinkingLevel: 'high',
      tools: ['current_time'],
      description: 'Research assistant',
      labels: ['research', 'team-a'],
      memoryPolicy: { extract: false, remember: true },
      budget: { dailyUsd: 5, monthlyUsd: 50, turnTokens: 200_000, onExceed: 'refuse' },
      credentials: { primary: { openai: credentialId }, fallback: { openai: null } },
      toolPolicy: { current_time: 'allow', remember: 'deny' },
    }
    expect(parseInput(schema, settings)).toEqual(settings)
  })

  it('rejects unknown fields, other shapes, models, and tools as client errors', () => {
    for (const [invalid, message] of [
      [{ ...valid, apiKey: 'secret' }, 'schemaVersion'],
      [{ ...valid, schemaVersion: 2 }, 'schemaVersion must be 1'],
      [{ ...valid, thinkingLevel: 'extreme' }, 'thinkingLevel'],
      [{ ...valid, model: { provider: 'openai', modelId: 'missing' } }, 'Unknown model'],
      [{ ...valid, tools: ['unknown_tool'] }, 'Unknown tool: unknown_tool'],
      [{ ...valid, tools: ['current_time', 'current_time'] }, 'unique'],
      [{ ...valid, memoryPolicy: { extract: true } }, 'memoryPolicy'],
      [{ ...valid, budget: { dailyUsd: 5 } }, 'onExceed'],
      [{ ...valid, budget: { dailyUsd: -1, onExceed: 'refuse' } }, 'positive'],
      // One accepted shape: a flat provider map is not translated.
      [{ ...valid, credentials: { openai: credentialId } }, 'primary and fallback'],
      [{ ...valid, credentials: { primary: { openai: 'key' }, fallback: {} } }, 'UUIDs'],
      [
        { ...valid, credentials: { primary: {}, fallback: { openai: credentialId } } },
        'fallback may only name',
      ],
      [{ ...valid, toolPolicy: { current_time: 'ask' } }, 'allow or deny'],
      [{ ...valid, labels: ['Team A'] }, 'Labels'],
    ] as const) {
      expect(() => parseInput(schema, invalid)).toThrow(TypeError)
      expect(() => parseInput(schema, invalid)).toThrow(message)
    }
  })
})

useMockModel()

function requestBody(index: number): string {
  const body = vi.mocked(globalThis.fetch).mock.calls[index]?.[1]?.body
  if (typeof body !== 'string') throw new Error(`Missing model request body ${index}`)
  return body
}

describe('agent configuration', () => {
  it('applies a new version to the next model request and keeps it after eviction', async () => {
    const agentId = await newAgentId()
    const original = await desiredSettings(agentId)
    const written = await updateSettings(agentId, {
      model: { provider: 'openai', modelId: 'gpt-6-sol' },
      systemPrompt: 'You are a research assistant. Cite evidence.',
      thinkingLevel: 'low',
      tools: ['current_time'],
    })
    // Either this push applies it, or the object, opening for the push, caught up first.
    expect(written).toMatchObject({ version: 1, apply: { appliedVersion: 1 } })
    const other = await newAgentId()
    expect(await env.AGENTS.getByName(other).getConfig()).toMatchObject({
      model: original.model,
      systemPrompt: original.systemPrompt,
    })
    await evictDurableObject(env.AGENTS.getByName(agentId))
    expect(await env.AGENTS.getByName(agentId).getConfig()).toMatchObject({
      model: { provider: 'openai', modelId: 'gpt-6-sol' },
      tools: ['current_time'],
    })
    await exports.default.sendMessage(agentId, { requestId: 'configured', content: 'Hello' })
    await waitForAnswer(agentId, 'configured')
    expect(requestBody(0)).toContain('gpt-6-sol')
    expect(requestBody(0)).toContain('You are a research assistant. Cite evidence.')
    expect(requestBody(0)).toContain('current_time')
    expect(requestBody(0)).not.toContain(original.systemPrompt)
    await expect
      .poll(async () => (await exports.default.snapshot(agentId)).snapshot.busy)
      .toBe(false)
    await updateSettings(agentId, { tools: [], systemPrompt: '' })
    await exports.default.sendMessage(agentId, { requestId: 'disabled', content: 'Again' })
    await waitForAnswer(agentId, 'disabled')
    // Deselecting every configurable tool leaves only the long-term memory tools.
    expect(requestBody(1)).not.toContain('current_time')
    expect(requestBody(1)).toContain('memory_search')
    expect(requestBody(1)).toContain('remember')
  })

  it('rejects invalid settings without writing a version or changing the agent', async () => {
    const agentId = await newAgentId()
    using before = await env.AGENTS.getByName(agentId).getConfig()
    for (const invalid of [
      { model: { provider: 'unknown', modelId: 'unknown' } },
      { tools: ['unknown_tool'] },
      { tools: ['current_time', 'current_time'] },
      { systemPrompt: 'x'.repeat(64_001) },
    ]) {
      await expect(updateSettings(agentId, invalid)).rejects.toThrow()
    }
    const versions = await management
      .select()
      .from(agentConfigVersions)
      .where(eq(agentConfigVersions.agentId, agentId))
    expect(versions).toEqual([])
    expect(await env.AGENTS.getByName(agentId).getConfig()).toEqual(before)
  })
})

it('switches providers through a version and keeps the selection after eviction', async () => {
  const agentId = await newAgentId()
  await exports.default.sendMessage(agentId, { requestId: 'openai', content: 'Hello' })
  await waitForAnswer(agentId, 'openai')
  await expect.poll(async () => (await exports.default.snapshot(agentId)).snapshot.busy).toBe(false)
  await updateSettings(agentId, { model: { provider: 'xai', modelId: 'grok-4.3' } })
  await evictDurableObject(env.AGENTS.getByName(agentId))
  expect((await env.AGENTS.getByName(agentId).getConfig()).model).toEqual({
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
