/**
 * The memory agent's queue hands out the due job of the lowest priority number, then the oldest.
 *
 * @module
 */
import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vite-plus/test'
import { uuidv7 } from '../../lib/uuid.ts'
import type { MemoryJob } from '../../memory/jobs.ts'
import setMemoryJobCreatedAt from '../../testing/sql/set-memory-job-created-at.sql'
import setMemoryJobNotBefore from '../../testing/sql/set-memory-job-not-before.sql'
import setMemoryJobSettled from '../../testing/sql/set-memory-job-settled.sql'
import { openLocalDb } from './local.ts'
import { nextJob, retryJob, STARVATION_LIMIT_MS, startJob, storeJob } from './memory-jobs.ts'

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
      setMemoryJobCreatedAt.runSync(local.sql, { jobId: newer.jobId, createdAt: 0 })

      const order: string[] = []
      for (let next = nextJob(local, Date.now()); next; next = nextJob(local, Date.now())) {
        order.push(next.jobId === newer.jobId ? 'consolidate (oldest)' : next.kind)
        setMemoryJobSettled.runSync(local.sql, { jobId: next.jobId, outcome: 'persisted' })
      }
      expect(order).toEqual(['remember', 'extract', 'consolidate (oldest)', 'consolidate'])
    })
  })

  it('runs a job overdue by more than the starvation limit ahead of higher priorities', async () => {
    await runInDurableObject(env.AGENTS.getByName(uuidv7()), async (_instance, state) => {
      const local = await openLocalDb(state.storage)
      const waiting = await storeJob(local, consolidate, undefined)
      const fresh = await storeJob(local, remember, undefined)
      const now = Date.now()
      const dueAt = (notBefore: number) =>
        setMemoryJobNotBefore.runSync(local.sql, { jobId: waiting.jobId, notBefore })

      dueAt(now - STARVATION_LIMIT_MS + 1)
      expect(nextJob(local, now)?.jobId).toBe(fresh.jobId)
      dueAt(now - STARVATION_LIMIT_MS)
      expect(nextJob(local, now)?.jobId).toBe(waiting.jobId)
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
