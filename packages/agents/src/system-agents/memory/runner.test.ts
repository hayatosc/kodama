/**
 * Memory jobs execute serially, only settled extractions without progress can be reopened, failed
 * attempts are retried, and recovery uses Pi's durable submissions rather than duplicating their
 * identity in the queue.
 *
 * @module
 */
import { uuidv7 } from '../../lib/uuid.ts'
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { memoryLedger } from '../../../drizzle/memory/schema.ts'
import { memoryJobs } from '../../../drizzle/durable-object/schema.ts'
import { JOB_RETRY_DELAYS_MS } from './runner.ts'
import {
  isMemoryAgentRequest,
  requestBody,
  textResponse,
  toolCallResponse,
  toolResults,
} from '../../helper/model.ts'
import {
  activeContents,
  memoryAgent,
  storedAlwaysLoaded,
  context,
  db,
} from '../../helper/memory.ts'
import { applyOperation } from '../../memory/store/records.ts'
import { setAlarm } from '../../runtime/alarms.ts'
import { openLocalDb } from '../../storage/local.ts'
import { settleJob } from '../../storage/memory-jobs.ts'
import { waitForAnswer } from '../../helper/rpc.ts'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'
import { newAgentId } from '../../helper/management.ts'

afterEach(() => vi.restoreAllMocks())

describe('extraction redelivery', () => {
  it.each(['declined', 'failed', 'progressed'] as const)(
    'handles a settled %s extraction',
    async (outcome) => {
      let calls = 0
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        calls += 1
        return textResponse('No checkpoint was written.')
      })
      const job = { kind: 'extract', sourceAgentId: uuidv7(), afterEntry: 0 } as const
      const first = await memoryAgent().enqueue(job)
      await expect
        .poll(async () => (await memoryAgent().jobStatus(first.jobId))?.status, { timeout: 10_000 })
        .toBe('settled')
      if (outcome === 'failed') {
        await runInDurableObject(memoryAgent(), async (_instance, state) => {
          settleJob(await openLocalDb(state.storage), first.jobId, 'failed')
        })
      }
      if (outcome === 'progressed') {
        await applyOperation(db, context(), {
          type: 'checkpoint',
          agentId: job.sourceAgentId,
          lastEntryId: 1,
        })
      }
      const second = await memoryAgent().enqueue(job)
      expect(second.jobId).toBe(first.jobId)
      if (outcome === 'progressed') {
        expect(second.status).toBe('settled')
        expect(calls).toBe(1)
      } else {
        expect(second.status).toBe('queued')
        await expect
          .poll(async () => (await memoryAgent().jobStatus(first.jobId))?.attempts, {
            timeout: 10_000,
          })
          .toBe(2)
        await expect
          .poll(async () => (await memoryAgent().jobStatus(first.jobId))?.status, {
            timeout: 10_000,
          })
          .toBe('settled')
        expect(calls).toBe(2)
      }
    },
  )
})

describe('remember', () => {
  it('saves what the user asks for through the memory agent and loads it on later turns', async () => {
    const agentId = await newAgentId()
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
          arguments: { content: fact },
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
      sourceAgentId: uuidv7(),
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
      sourceAgentId: uuidv7(),
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
})

describe('retries', () => {
  it('queues a failed attempt again, and records a job that fails every attempt', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: { message: 'bad', type: 'invalid_request_error' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    const { jobId } = await memoryAgent().enqueue({
      kind: 'remember',
      sourceAgentId: uuidv7(),
      content: 'A job the model never answers',
      sourceEntries: { from: 1, to: 1 },
    })
    // docs/memory.md — Jobs: retried after 1 minute, 10 minutes, and 1 hour.
    expect(JOB_RETRY_DELAYS_MS).toEqual([60_000, 10 * 60_000, 60 * 60_000])
    const attempts = JOB_RETRY_DELAYS_MS.length + 1

    for (let attempt = 1; attempt < attempts; attempt++) {
      await expect
        .poll(() => memoryAgent().jobStatus(jobId), { timeout: 10_000 })
        .toMatchObject({ status: 'queued', attempts: attempt })
      // Make the delayed retry due now rather than waiting for its delay.
      await runInDurableObject(memoryAgent(), async (_instance, state) => {
        const local = await openLocalDb(state.storage)
        const row = local.select().from(memoryJobs).where(eq(memoryJobs.jobId, jobId)).get()
        const delay = JOB_RETRY_DELAYS_MS[attempt - 1] ?? 0
        expect(row?.notBefore).toBeGreaterThan(Date.now() + delay - 10_000)
        expect(row?.notBefore).toBeLessThanOrEqual(Date.now() + delay)
        local.update(memoryJobs).set({ notBefore: 0 }).where(eq(memoryJobs.jobId, jobId)).run()
        await setAlarm(state.storage, 'jobs', Date.now())
      })
      await runDurableObjectAlarm(memoryAgent())
    }

    await expect
      .poll(() => memoryAgent().jobStatus(jobId), { timeout: 10_000 })
      .toMatchObject({ status: 'settled', outcome: 'failed', attempts })
    const failure = await db
      .select()
      .from(memoryLedger)
      .where(and(eq(memoryLedger.targetId, jobId), eq(memoryLedger.action, 'job_failed')))
      .get()
    expect(failure?.detailJson).toBe(JSON.stringify({ kind: 'remember', attempts }))
  })
})

describe('memory job recovery', () => {
  it('settles a completed Pi submission after eviction without another model call or write', async () => {
    const sourceAgentId = await newAgentId()
    const content = 'Deploy only after the checks pass.'
    const model = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (_input, init) =>
        toolResults(requestBody(init)) === 0
          ? toolCallResponse({ name: 'memory_write', arguments: { kind: 'instruction', content } })
          : textResponse('Saved.'),
      )
    const stub = memoryAgent()
    const { jobId } = await stub.enqueue({
      kind: 'remember',
      sourceAgentId,
      content,
      sourceEntries: { from: 1, to: 1 },
    })
    await expect
      .poll(async () => stub.jobStatus(jobId), { timeout: 10_000 })
      .toMatchObject({ status: 'settled', outcome: 'persisted', attempts: 1 })
    using original = await stub.submission(`${jobId}-1`)
    expect(original?.status).toBe('done')
    expect(model).toHaveBeenCalledTimes(2)

    // Recreate a stop after Pi committed its result but before Kodama settled the job.
    await runInDurableObject(stub, async (_instance, state) => {
      const local = await openLocalDb(state.storage)
      local
        .update(memoryJobs)
        .set({ status: 'running', outcome: null, settledAt: null })
        .where(eq(memoryJobs.jobId, jobId))
        .run()
      await setAlarm(state.storage, 'jobs', Date.now() + 60_000)
    })
    await evictDurableObject(stub)
    await runDurableObjectAlarm(stub)

    await expect
      .poll(async () => stub.jobStatus(jobId), { timeout: 10_000 })
      .toMatchObject({ status: 'settled', outcome: 'persisted', attempts: 1 })
    using resumed = await stub.submission(`${jobId}-1`)
    expect(resumed?.id).toBe(original?.id)
    expect(await activeContents(sourceAgentId)).toEqual([content])
    expect(model).toHaveBeenCalledTimes(2)
  })
})
