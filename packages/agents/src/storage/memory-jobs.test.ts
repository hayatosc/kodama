/**
 * The memory agent's queue hands out the due job of the lowest priority number, then the oldest.
 *
 * @module
 */
import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { memoryJobs } from '../../drizzle/durable-object/schema.ts'
import { uuidv7 } from '../lib/uuid.ts'
import type { MemoryJob } from '../memory/jobs.ts'
import { openLocalDb } from './local.ts'
import { nextJob, retryJob, startJob, storeJob } from './memory-jobs.ts'

const agentId = uuidv7()
const consolidate: MemoryJob = { kind: 'consolidate', scope: `agent:${agentId}`, day: '2026-01-01' }
const remember: MemoryJob = {
  kind: 'remember',
  sourceAgentId: agentId,
  content: 'Prefer tabs',
  sourceEntries: { from: 1, to: 1 },
}
const jobs: readonly MemoryJob[] = [
  consolidate,
  { kind: 'extract', sourceAgentId: agentId, afterEntry: 1 },
  remember,
]

describe('nextJob', () => {
  it('takes remember, extract, then consolidate, and the oldest within a kind', async () => {
    await runInDurableObject(env.AGENTS.getByName(uuidv7()), async (_instance, state) => {
      const local = await openLocalDb(state.storage)
      // Queued in reverse priority order, so age alone would invert the order.
      for (const job of jobs) await storeJob(local, job, undefined)
      const newer = await storeJob(
        local,
        { kind: 'consolidate', scope: `agent:${agentId}`, day: '2026-01-02' },
        undefined,
      )
      local.update(memoryJobs).set({ createdAt: 0 }).where(eq(memoryJobs.jobId, newer.jobId)).run()

      const order: string[] = []
      for (let next = nextJob(local, Date.now()); next; next = nextJob(local, Date.now())) {
        order.push(next.jobId === newer.jobId ? 'consolidate (oldest)' : next.kind)
        local
          .update(memoryJobs)
          .set({ status: 'settled', outcome: 'persisted' })
          .where(eq(memoryJobs.jobId, next.jobId))
          .run()
      }
      expect(order).toEqual(['remember', 'extract', 'consolidate (oldest)', 'consolidate'])
    })
  })

  it('skips a retry until it is due, and resumes a running job first', async () => {
    await runInDurableObject(env.AGENTS.getByName(uuidv7()), async (_instance, state) => {
      const local = await openLocalDb(state.storage)
      const urgent = await storeJob(local, remember, undefined)
      const later = await storeJob(local, consolidate, undefined)
      const now = Date.now()
      retryJob(local, urgent.jobId, now + 60_000)

      expect(nextJob(local, now)?.jobId).toBe(later.jobId)
      expect(nextJob(local, now + 60_000)?.jobId).toBe(urgent.jobId)
      const running = nextJob(local, now)
      if (running === undefined) throw new Error('Missing job')
      startJob(local, running)
      expect(nextJob(local, now + 60_000)?.jobId).toBe(later.jobId)
    })
  })
})
