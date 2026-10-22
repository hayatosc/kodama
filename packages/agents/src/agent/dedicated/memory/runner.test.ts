import { runInDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MEMORY_AGENT_NAME } from '../../../memory/jobs.ts'
import { Agent } from '../../agent.ts'
import { MemoryAgent } from './agent.ts'
import {
  isMemoryAgentRequest,
  requestBody,
  textResponse,
  toolCallResponse,
  toolResults,
} from '../../../helper/model.ts'
import { activeContents, memoryAgent, storedAlwaysLoaded } from '../../../helper/memory.ts'
import { waitForAnswer } from '../../../helper/rpc.ts'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'

afterEach(() => vi.restoreAllMocks())

describe('remember', () => {
  it('saves what the user asks for through the memory agent and loads it on later turns', async () => {
    const agentId = crypto.randomUUID()
    const fact = `The deploy target is region ${agentId.slice(0, 8)}`
    const bodies: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = requestBody(init)
      if (isMemoryAgentRequest(body)) {
        const step = toolResults(body)
        if (step === 0)
          return toolCallResponse({ name: 'memory_search', arguments: { query: fact } })
        if (step === 1) {
          return toolCallResponse({
            name: 'memory_write',
            arguments: { kind: 'fact', content: fact },
          })
        }
        return textResponse('Saved the fact.')
      }
      bodies.push(body)
      if (body.includes('Remember the deploy target') && toolResults(body) === 0) {
        return toolCallResponse({
          name: 'remember',
          arguments: { content: fact, origin: 'user_request' },
        })
      }
      return textResponse('OK')
    })

    await exports.default.sendMessage(agentId, {
      requestId: 'remember',
      content: `Remember the deploy target: ${fact}`,
    })
    await waitForAnswer(agentId, 'remember')

    await expect.poll(() => activeContents(agentId), { timeout: 10_000 }).toEqual([fact])
    await expect.poll(() => storedAlwaysLoaded(agentId), { timeout: 10_000 }).toContain(fact)
    await exports.default.sendMessage(agentId, {
      requestId: 'later',
      content: 'Where do we deploy?',
    })
    await waitForAnswer(agentId, 'later')
    expect(bodies.at(-1)).toContain(fact)
    expect(bodies.at(-1)).toContain('MEMORY [')
  })

  it('returns the same job when the same remember job is delivered twice', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) =>
      toolResults(requestBody(init)) === 0
        ? toolCallResponse({ name: 'memory_decline', arguments: { reason: 'test' } })
        : textResponse('Declined.'),
    )
    const job = {
      kind: 'remember',
      sourceAgentId: crypto.randomUUID(),
      origin: 'agent_judgment',
      content: 'Prefers short answers',
      sourceEntries: { from: 3, to: 3 },
    }

    const first = await memoryAgent().enqueue(job)
    const second = await memoryAgent().enqueue(job)

    expect(second.jobId).toBe(first.jobId)
    await expect
      .poll(async () => (await memoryAgent().jobStatus(first.jobId))?.outcome, { timeout: 10_000 })
      .toBe('declined')
    expect((await memoryAgent().jobStatus(first.jobId))?.attempts).toBe(1)
  })

  it('runs queued jobs one at a time, each without the context of the one before', async () => {
    const candidates = ['first-job-candidate', 'second-job-candidate']
    const mixed: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = requestBody(init)
      if (candidates.every((candidate) => body.includes(candidate))) mixed.push(body)
      return toolResults(body) === 0
        ? toolCallResponse({ name: 'memory_decline', arguments: { reason: 'test' } })
        : textResponse('Declined.')
    })
    const jobs = candidates.map((content) => ({
      kind: 'remember',
      sourceAgentId: crypto.randomUUID(),
      origin: 'agent_judgment',
      content,
      sourceEntries: { from: 1, to: 1 },
    }))

    const statuses = await Promise.all(jobs.map((job) => memoryAgent().enqueue(job)))

    for (const status of statuses) {
      await expect
        .poll(async () => (await memoryAgent().jobStatus(status.jobId))?.outcome, {
          timeout: 10_000,
        })
        .toBe('declined')
    }
    expect(mixed).toEqual([])
  })

  it('takes input only through its job queue', async () => {
    const rejection = (promise: Promise<unknown>) =>
      promise.then(
        () => undefined,
        (error: unknown) => String(error),
      )
    expect(
      await rejection(memoryAgent().sendMessage({ requestId: 'direct', content: 'Remember this' })),
    ).toMatch(/enqueue/)
    expect(await rejection(memoryAgent().enqueue({ kind: 'unknown' }))).toMatch(/Invalid type/)
  })

  it('uses the default model when MEMORY_MODEL_* are not set', async () => {
    using config = await memoryAgent().getConfig()
    expect(config.model).toEqual({
      provider: env.DEFAULT_MODEL_PROVIDER,
      modelId: env.DEFAULT_MODEL_ID,
    })
  })

  it('is a MemoryAgent in the AGENTS namespace that public RPC cannot address', async () => {
    const rejection = (promise: Promise<unknown>) =>
      promise.then(
        () => '',
        (error: unknown) => String(error),
      )
    expect(await rejection(Promise.resolve(exports.default.snapshot(MEMORY_AGENT_NAME)))).toMatch(
      /agentId/,
    )
    const kinds = (instance: unknown) => [
      instance instanceof Agent,
      instance instanceof MemoryAgent,
    ]
    const working = env.AGENTS.getByName(crypto.randomUUID())
    expect(await runInDurableObject(memoryAgent(), kinds)).toEqual([true, true])
    expect(await runInDurableObject(working, kinds)).toEqual([true, false])
    expect(
      await rejection(working.enqueue({ kind: 'extract', sourceAgentId: 'a', afterEntry: 0 })),
    ).toMatch(/Only the memory agent/)
  })
})
