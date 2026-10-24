import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_MAINTENANCE_ERROR } from '../../agent/memory.ts'
import { searchHistory } from '../archive/history.ts'
import { PRUNE_LIMITS_KEY, prunedThrough } from './runs.ts'
import { memoryDb } from '../store/db.ts'
import { archiveSegments } from '../../../drizzle/d1/schema.ts'
import { MEMORY_AGENT_NAME } from '../jobs.ts'
import { memoryJobs, pruneRuns } from '../../../drizzle/durable-object/schema.ts'
import { openLocalDb } from '../../storage/local.ts'
import {
  BACKGROUND_USAGE,
  COMPACT_AFTER_TURN_7,
  compactedAgent,
  FILLER,
  headOf,
  mockModel,
  say,
  storedEntryIds,
} from '../../helper/conversation.ts'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'
import { newAgentId } from '../../helper/control.ts'

const db = memoryDb(env.MEMORY_DB)
afterEach(() => vi.restoreAllMocks())

describe('pruning', () => {
  it('archives the entries before the newest head, deletes them, and the conversation goes on', async () => {
    const agentId = await newAgentId()
    const codename = `zephyrine${agentId.slice(0, 6)}`
    const bodies = mockModel({
      usage: COMPACT_AFTER_TURN_7,
    })
    await compactedAgent(agentId, codename)
    const head = await headOf(agentId)
    expect(head).toBeGreaterThan(1)
    const stub = env.AGENTS.getByName(agentId)
    const sizeBefore = await runInDurableObject(stub, (_i, state) => state.storage.sql.databaseSize)

    expect(await stub.prune({ force: true })).toBe('pruned')

    const ids = await storedEntryIds(agentId)
    expect(ids.every((id) => id >= (head ?? 0))).toBe(true)
    const segments = await db
      .select()
      .from(archiveSegments)
      .where(eq(archiveSegments.agentId, agentId))
    expect(segments).toHaveLength(1)
    expect(segments[0]?.lastEntry).toBeLessThan(head ?? 0)

    // History search finds the exact word, and extraction reads the pruned range back from R2.
    const found = await searchHistory(db, env.ARCHIVE, agentId, codename)
    expect(found.hits.map((hit) => hit.text).join('\n')).toContain(codename)
    const page = await stub.readEntries({ after: 0, limit: 5 })
    expect(page.entries[0]?.text).toContain(codename)
    expect(page.end).toBe(false)

    await say(agentId, 'after', 'Still there?')
    expect(bodies.at(-1)).toContain('Summary: the user set a codename')
    expect(bodies.at(-1)).toContain('Still there?')
    const sizeAfter = await runInDurableObject(stub, (_i, state) => state.storage.sql.databaseSize)
    expect(sizeAfter).toBeLessThanOrEqual(sizeBefore)

    // The memory agent got the archived range to summarize.
    const jobs = await runInDurableObject(
      env.AGENTS.getByName(MEMORY_AGENT_NAME),
      async (_i, state) => {
        const local = await openLocalDb(state.storage)
        return local.select({ kind: memoryJobs.kind }).from(memoryJobs).all()
      },
    )
    expect(jobs.map((job) => job.kind)).toContain('record_archive')
  })

  it('defers the delete while a background compaction runs, then finishes it', async () => {
    const agentId = await newAgentId()
    let release = () => {}
    let gated = false
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mockModel({
      // Answer 10 reports a context in the background band, so answer 11 starts a compaction.
      usage: (n) => (n === 10 ? BACKGROUND_USAGE : COMPACT_AFTER_TURN_7(n)),
      gate: () => (gated ? gate : undefined),
    })
    await compactedAgent(agentId, 'first')
    const firstHead = (await headOf(agentId)) ?? 0
    for (let turn = 9; turn < 11; turn++) await say(agentId, `t${turn}`, `Turn ${turn}.${FILLER}`)
    gated = true
    // The background compaction starts here and waits for the gate; the turn itself completes.
    await say(agentId, 'background', 'Turn 11.')
    const stub = env.AGENTS.getByName(agentId)

    expect(await stub.prune({ force: true })).toBe('deferred')
    const alarm = await runInDurableObject(stub, (_i, state) =>
      state.storage.get('kodama:alarm:prune'),
    )
    expect(alarm).toBeGreaterThan(Date.now())

    release()
    await expect
      .poll(async () => (await headOf(agentId)) ?? 0, { timeout: 10_000 })
      .toBeGreaterThan(firstHead)
    // The deferred run is carried on; the second head is pruned by the next run.
    expect(await stub.prune()).toBe('pruned')
    expect((await storedEntryIds(agentId)).every((id) => id >= firstHead)).toBe(true)
  })

  it('resumes a run that stopped after it was prepared', async () => {
    const agentId = await newAgentId()
    mockModel({ usage: COMPACT_AFTER_TURN_7 })
    await compactedAgent(agentId, 'resumed')
    const head = (await headOf(agentId)) ?? 0
    const stub = env.AGENTS.getByName(agentId)
    await runInDurableObject(stub, async (_i, state) => {
      const local = await openLocalDb(state.storage)
      const now = Date.now()
      local
        .insert(pruneRuns)
        .values({
          firstEntry: 1,
          lastEntry: head - 1,
          head,
          state: 'prepared',
          createdAt: now,
          updatedAt: now,
        })
        .run()
    })

    // Without force and under the threshold, only the unfinished run is carried on.
    expect(await stub.prune()).toBe('pruned')
    expect(await stub.prune()).toBe('nothing')

    const pruned = await runInDurableObject(stub, async (_i, state) =>
      prunedThrough(await openLocalDb(state.storage)),
    )
    expect(pruned).toBe(head - 1)
    expect((await storedEntryIds(agentId)).every((id) => id >= head)).toBe(true)
  })

  it('schedules pruning when idle above the threshold', async () => {
    const agentId = await newAgentId()
    mockModel({ usage: COMPACT_AFTER_TURN_7 })
    const stub = env.AGENTS.getByName(agentId)
    await runInDurableObject(stub, (_i, state) =>
      state.storage.put(PRUNE_LIMITS_KEY, { thresholdBytes: 0 }),
    )
    await compactedAgent(agentId, 'scheduled')
    const head = (await headOf(agentId)) ?? 0

    await expect
      .poll(() => runInDurableObject(stub, (_i, state) => state.storage.get('kodama:alarm:prune')))
      .toBeDefined()
    await runInDurableObject(stub, (_i, state) =>
      state.storage.put('kodama:alarm:prune', Date.now() - 1),
    )
    await runDurableObjectAlarm(stub)

    expect((await storedEntryIds(agentId)).every((id) => id >= head)).toBe(true)
  })

  it('refuses input above the hard limit with a retryable error', async () => {
    const agentId = await newAgentId()
    const stub = env.AGENTS.getByName(agentId)
    await runInDurableObject(stub, (_i, state) =>
      state.storage.put(PRUNE_LIMITS_KEY, { hardBytes: 0 }),
    )

    // Refuse and read the schedule in one request, before the alarm, due at once, can run.
    const refusal = await runInDurableObject(stub, async (instance, state) => {
      const error = await instance.sendMessage({ requestId: 'refused', content: 'Hello' }).then(
        () => undefined,
        (reason: unknown) => String(reason),
      )
      return { error, scheduled: (await state.storage.get('kodama:alarm:prune')) !== undefined }
    })

    expect(refusal.error).toContain(STORAGE_MAINTENANCE_ERROR)
    expect(refusal.scheduled).toBe(true)
    // The alarm finds nothing to prune in an empty conversation and clears itself, whether it
    // already ran on its own or runs now.
    await runDurableObjectAlarm(stub)
    await expect
      .poll(() => runInDurableObject(stub, (_i, state) => state.storage.get('kodama:alarm:prune')))
      .toBeUndefined()
  })
})

describe('memory agent pruning', () => {
  it('deletes its finished jobs without an archive', async () => {
    mockModel({ usage: () => 5 })
    const stub = env.AGENTS.getByName(MEMORY_AGENT_NAME)
    await runInDurableObject(stub, (_i, state) =>
      state.storage.put(PRUNE_LIMITS_KEY, { thresholdBytes: 0 }),
    )
    try {
      for (const content of ['first candidate', 'second candidate']) {
        const status = await stub.enqueue({
          kind: 'remember',
          sourceAgentId: crypto.randomUUID(),
          origin: 'agent_judgment',
          content,
          sourceEntries: { from: 1, to: 1 },
        })
        await expect
          .poll(async () => (await stub.jobStatus(status.jobId))?.status, { timeout: 10_000 })
          .toBe('settled')
      }
      await expect
        .poll(
          () =>
            runInDurableObject(stub, async (_i, state) =>
              prunedThrough(await openLocalDb(state.storage)),
            ),
          { timeout: 10_000 },
        )
        .toBeGreaterThan(0)
      const segments = await db
        .select()
        .from(archiveSegments)
        .where(eq(archiveSegments.agentId, MEMORY_AGENT_NAME))
      expect(segments).toEqual([])
    } finally {
      await runInDurableObject(stub, (_i, state) => state.storage.delete(PRUNE_LIMITS_KEY))
    }
  })
})
