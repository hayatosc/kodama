import { uuidv7 } from '../../lib/uuid.ts'
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_MAINTENANCE_ERROR } from '../../runtime/pruning.ts'
import { searchHistory } from '../archive/history.ts'
import { applyOperation } from '../store/records.ts'
import type { NewRecord } from '../store/records.ts'
import type { ToolCall } from '../../helper/model.ts'
import { requestBody, textResponse, toolCallResponse, toolResults } from '../../helper/model.ts'
import { PRUNE_LIMITS_KEY } from './runs.ts'
import { prunedThrough } from '../../storage/pruning.ts'
import { memoryDb } from '../store/db.ts'
import { archiveSegments } from '../../../drizzle/memory/schema.ts'
import { MEMORY_AGENT_NAME } from '../jobs.ts'
import { memoryJobs, pruneRuns } from '../../../drizzle/durable-object/schema.ts'
import { openLocalDb } from '../../storage/local.ts'
import { markContact } from '../../storage/external-data.ts'
import { ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
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
import { newAgentId, updateSettings } from '../../helper/management.ts'

const db = memoryDb(env.MEMORY_DB)
afterEach(() => vi.restoreAllMocks())

/** The newest rendering of the `memory` section in a request body. */
function latestMemorySection(body: string): string {
  const start = body.lastIndexOf('<memory>')
  return start < 0 ? '' : body.slice(start, body.indexOf('</memory>', start))
}

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
    const segment = segments[0]
    if (!segment) throw new Error('Missing archived segment')
    expect(segment.firstEntry).toBeLessThanOrEqual(segment.lastEntry)
    const runs = await runInDurableObject(stub, async (_i, state) => {
      const local = await openLocalDb(state.storage)
      return local.select().from(pruneRuns).all()
    })
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ firstEntry: segment.firstEntry, lastEntry: segment.lastEntry })

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

    // The memory agent gets the range only to extract from; nothing summarizes the archive.
    const jobs = await runInDurableObject(
      env.AGENTS.getByName(MEMORY_AGENT_NAME),
      async (_i, state) => {
        const local = await openLocalDb(state.storage)
        return local.select().from(memoryJobs).all()
      },
    )
    expect(jobs.filter((job) => job.payloadJson.includes(agentId)).map((job) => job.kind)).toEqual([
      'extract',
    ])
    // Contact while an archive page is in flight excludes its text, not its scan progress.
    const excluded = await runInDurableObject(stub, async (agent, state) => {
      const reached = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const get = env.ARCHIVE.get.bind(env.ARCHIVE)
      const spy = vi.spyOn(env.ARCHIVE, 'get').mockImplementationOnce(async (...args) => {
        const object = await get(...args)
        reached.resolve()
        await release.promise
        return object
      })
      const reading = agent.readEntries({ after: 0, limit: 5 })
      await reached.promise
      markContact(await openLocalDb(state.storage), String(ROOT_CONVERSATION_ID), 'peer', 0)
      release.resolve()
      return reading.finally(() => spy.mockRestore())
    })
    expect(excluded.entries).toEqual([])
    expect(excluded.through).toBe(page.through)
    expect(excluded.end).toBe(false)
  })

  it('hands pruned entries to extraction only while the memory policy extracts', async () => {
    const jobsOf = (agentId: string) =>
      runInDurableObject(env.AGENTS.getByName(MEMORY_AGENT_NAME), async (_i, state) => {
        const local = await openLocalDb(state.storage)
        return local
          .select({ kind: memoryJobs.kind, payloadJson: memoryJobs.payloadJson })
          .from(memoryJobs)
          .all()
          .filter((job) => job.payloadJson.includes(agentId))
          .map((job) => job.kind)
      })
    const [extracting, private_] = [await newAgentId(), await newAgentId()]
    await updateSettings(private_, { memoryPolicy: { extract: false, remember: true } })
    for (const agentId of [extracting, private_]) {
      // Each conversation counts its own turns towards compaction.
      mockModel({ usage: COMPACT_AFTER_TURN_7 })
      await compactedAgent(agentId, `quokka${agentId.slice(0, 6)}`)
      expect(await env.AGENTS.getByName(agentId).prune({ force: true })).toBe('pruned')
    }

    expect(await jobsOf(extracting)).toContain('extract')
    // Nothing else reads the archived entries, so the memory agent never sees them.
    expect(await jobsOf(private_)).toEqual([])
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

    const alarm = () =>
      runInDurableObject(stub, (_i, state) => state.storage.get('kodama:alarm:prune'))
    const pruned = async () => (await storedEntryIds(agentId)).every((id) => id >= head)
    // The alarm is due at once, so the platform may already have run it.
    await expect.poll(async () => (await alarm()) !== undefined || (await pruned())).toBe(true)
    if ((await alarm()) !== undefined) {
      await runInDurableObject(stub, (_i, state) =>
        state.storage.put('kodama:alarm:prune', Date.now() - 1),
      )
      await runDurableObjectAlarm(stub)
    }

    await expect.poll(pruned).toBe(true)
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
          sourceAgentId: uuidv7(),
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

  it('prunes between jobs while the queue never empties', async () => {
    // A fresh stub per call: continuations after the model's promises run in another context.
    const stub = () => env.AGENTS.getByName(MEMORY_AGENT_NAME)
    const pruned = () =>
      runInDurableObject(stub(), async (_i, state) =>
        prunedThrough(await openLocalDb(state.storage)),
      )
    const job = (content: string) =>
      stub().enqueue({
        kind: 'remember',
        sourceAgentId: uuidv7(),
        content,
        sourceEntries: { from: 1, to: 1 },
      })
    const status = (jobId: string) => async () => (await stub().jobStatus(jobId))?.status
    const releaseHeld = Promise.withResolvers<void>()
    const nextStarted = Promise.withResolvers<void>()
    const releaseNext = Promise.withResolvers<void>()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = requestBody(init)
      if (body.includes('held-job') && toolResults(body) === 0) await releaseHeld.promise
      if (body.includes('next-job') && toolResults(body) === 0) {
        nextStarted.resolve()
        await releaseNext.promise
      }
      return textResponse('Done.')
    })
    await runInDurableObject(stub(), (_i, state) =>
      state.storage.put(PRUNE_LIMITS_KEY, { thresholdBytes: 0 }),
    )
    try {
      // Leave entries of a finished job behind, then keep the queue busy.
      const warmUp = await job('warm-up-job')
      await expect.poll(status(warmUp.jobId), { timeout: 10_000 }).toBe('settled')
      const before = await pruned()
      const held = await job('held-job')
      const next = await job('next-job')
      releaseHeld.resolve()
      await nextStarted.promise

      // The next job is running, so the queue never emptied; pruning ran in between anyway.
      expect(await stub().jobStatus(held.jobId)).toMatchObject({ status: 'settled' })
      expect(await pruned()).toBeGreaterThan(before)
      releaseNext.resolve()
      await expect.poll(status(next.jobId), { timeout: 10_000 }).toBe('settled')
    } finally {
      releaseHeld.resolve()
      releaseNext.resolve()
      await runInDurableObject(stub(), (_i, state) => state.storage.delete(PRUNE_LIMITS_KEY))
    }
  })
})

// Probes after compaction and pruning (docs/memory.md, Evaluation). The model is scripted, so
// these check that what an agent needs reaches its context, not how well a model uses it.
describe('evaluation after pruning', () => {
  it('keeps recall, history, updates, abstention, and request receipts after pruning', async () => {
    const agentId = await newAgentId()
    const codename = `marigold${agentId.slice(0, 6)}`
    let pending: ToolCall | undefined
    const bodies = mockModel({
      usage: COMPACT_AFTER_TURN_7,
      answer: () => {
        const call = pending
        pending = undefined
        return call === undefined ? undefined : toolCallResponse(call)
      },
    })
    await compactedAgent(agentId, codename)
    using first = await exports.default.submission(agentId, 't0')

    // Extraction's result, citing the first turn: a decision the agent must keep.
    const now = Date.now()
    const decision: NewRecord = {
      scope: `agent:${agentId}`,
      kind: 'instruction',
      content: 'Deploy through the staging cluster first',
      origin: 'extraction',
      sourceAgentId: agentId,
      sourceEntries: { from: 1, to: 1 },
      observedAt: now,
    }
    const written = await applyOperation(
      db,
      { opId: uuidv7(), jobId: 'eval', runId: 'eval', actor: 'test', now },
      { type: 'write', record: decision },
    )
    const stub = env.AGENTS.getByName(agentId)
    expect(await stub.prune({ force: true })).toBe('pruned')
    await evictDurableObject(stub)

    // Recall: the decision is in the always-loaded memory, the early turns in the summary.
    await say(agentId, 'recall', 'How do we deploy?')
    expect(bodies.at(-1)).toContain('Deploy through the staging cluster first')
    expect(bodies.at(-1)).toContain('Summary: the user set a codename')

    // History: a word only in the pruned entries is found in the archive.
    pending = { name: 'history_search', arguments: { query: codename } }
    await say(agentId, 'history', 'What was the codename?')
    expect(bodies.at(-1)).toContain(`The codename is ${codename}.`)

    // Knowledge update: newer evidence replaces the decision, and only the new one is loaded.
    if (written.status !== 'applied') throw new Error('The decision was not written')
    const superseded = await applyOperation(
      db,
      { opId: uuidv7(), jobId: 'eval', runId: 'eval', actor: 'test', now: now + 1 },
      {
        type: 'supersede',
        oldId: written.recordId,
        oldRevision: 1,
        record: {
          ...decision,
          content: 'Deploy straight to production',
          sourceEntries: { from: 30, to: 30 },
        },
      },
    )
    expect(superseded.status).toBe('applied')
    await stub.memoryChanged()
    await say(agentId, 'update', 'How do we deploy now?')
    // Pi appends a changed section as a message, so the earlier version stays in history.
    expect(latestMemorySection(bodies.at(-1) ?? '')).toContain('Deploy straight to production')
    expect(latestMemorySection(bodies.at(-1) ?? '')).not.toContain(
      'Deploy through the staging cluster first',
    )

    // Abstention: what was never said is found nowhere.
    pending = { name: 'memory_search', arguments: { query: 'quokka sanctuary' } }
    await say(agentId, 'unknown', 'Where is the quokka sanctuary?')
    expect(bodies.at(-1)).toContain('No matching memory.')

    // Temporal: a search bounded before the archive's time finds nothing older.
    const found = await searchHistory(db, env.ARCHIVE, agentId, codename, {
      before: Date.now() + 1,
    })
    const older = await searchHistory(db, env.ARCHIVE, agentId, codename, { before: 1 })
    expect(found.hits).not.toHaveLength(0)
    expect(older).toMatchObject({ hits: [], complete: true })

    // Receipts: a retried request ID from the pruned range answers with its first submission.
    const requests = bodies.length
    const retried = await exports.default.sendMessage(agentId, {
      requestId: 't0',
      content: 'again',
    })
    expect(retried.submissionId).toBe(first?.submission.id)
    expect(bodies).toHaveLength(requests)
  })
})
