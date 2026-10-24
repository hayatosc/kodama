/**
 * Job recovery uses Pi's durable submissions rather than duplicating their identity in the queue.
 *
 * @module
 */
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { memoryJobs } from '../../../drizzle/durable-object/schema.ts'
import { newAgentId } from '../../helper/management.ts'
import { activeContents, memoryAgent } from '../../helper/memory.ts'
import { requestBody, textResponse, toolCallResponse, toolResults } from '../../helper/model.ts'
import { setAlarm } from '../../runtime/alarms.ts'
import { openLocalDb } from '../../storage/local.ts'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'

afterEach(() => vi.restoreAllMocks())

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
      origin: 'user_request',
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
