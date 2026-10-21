import { exports } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyOperation } from '../store/records.ts'
import { memoryLedger } from '../../../drizzle/d1/schema/records.ts'
import {
  isMemoryAgentRequest,
  requestBody,
  textResponse,
  toolCallResponse,
  toolResults,
} from '../../testing/model.ts'
import { activeContents, db, memoryAgent, storedAlwaysLoaded } from '../../testing/memory.ts'
import { waitForAnswer } from '../../testing/rpc.ts'
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
})

describe('consolidation', () => {
  it('merges duplicates of a changed scope and drops ledger rows past the rollback window', async () => {
    const agentId = crypto.randomUUID()
    const now = Date.now()
    for (const content of ['The CI runs on Linux', 'CI runs on Linux machines']) {
      await applyOperation(
        db,
        { opId: crypto.randomUUID(), jobId: 'seed', runId: 'seed', actor: 'test', now },
        {
          type: 'write',
          record: {
            scope: `agent:${agentId}`,
            kind: 'fact',
            content,
            origin: 'agent_judgment',
            sourceAgentId: agentId,
            sourceEntries: { from: 1, to: 1 },
            observedAt: now,
          },
        },
      )
    }
    await db.insert(memoryLedger).values({
      at: 0,
      runId: 'ancient',
      actor: 'test',
      action: 'write',
      target: 'record',
      targetId: agentId,
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = requestBody(init)
      const step = toolResults(body)
      if (!body.includes(`Job: consolidate scope agent:${agentId}`)) {
        return step === 0
          ? toolCallResponse({ name: 'memory_decline', arguments: { reason: 'test' } })
          : textResponse('Declined.')
      }
      if (step === 0) return toolCallResponse({ name: 'list_records', arguments: {} })
      if (step === 1) {
        const duplicate = /id=(\S+) revision=(\d+) kind=fact[^\n]*: CI runs on Linux machines/.exec(
          body.replaceAll('\\n', '\n'),
        )
        return toolCallResponse({
          name: 'memory_invalidate',
          arguments: {
            id: duplicate?.[1] ?? '',
            revision: Number(duplicate?.[2]),
            reason: 'duplicate',
          },
        })
      }
      return textResponse('Consolidated.')
    })

    const result = await memoryAgent().consolidate(now)

    expect(result.scopes).toBeGreaterThanOrEqual(1)
    await expect
      .poll(() => activeContents(agentId), { timeout: 10_000 })
      .toEqual(['The CI runs on Linux'])
    const ancient = await db.select().from(memoryLedger).where(eq(memoryLedger.runId, 'ancient'))
    expect(ancient).toEqual([])
    const meta = await db.select().from(memoryLedger).where(eq(memoryLedger.action, 'meta'))
    expect(meta.length).toBeGreaterThan(0)
  })
})
