import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/durable-sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_MAINTENANCE_ERROR } from '../src/agent.ts'
import { searchHistory } from '../src/memory/archive.ts'
import { PRUNE_LIMITS_KEY, prunedThrough } from '../src/memory/prune.ts'
import { memoryDb } from '../src/memory/records.ts'
import { archiveSegments } from '../src/memory/schema.ts'
import { MEMORY_AGENT_NAME } from '../src/memory/working.ts'
import { createAgentModels } from '../src/models/index.ts'
import { memoryJobs, pruneRuns } from '../src/storage/local-schema.ts'
import { openLocalDb } from '../src/storage/local.ts'
import { piEntries } from '../src/storage/pi-tables.ts'
import {
  isMemoryAgentRequest,
  isSummaryRequest,
  requestBody,
  textResponse,
  toolCallResponse,
  toolResults,
} from './model.ts'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'

const db = memoryDb(env.MEMORY_DB)
const contextWindow =
  createAgentModels(env).getModel(env.DEFAULT_MODEL_PROVIDER, env.DEFAULT_MODEL_ID)
    ?.contextWindow ?? 0
// Pi's defaults: block to compact above window - 16384, start in the background 32768 below that.
const BLOCKING_USAGE = contextWindow
const BACKGROUND_USAGE = contextWindow - 16_384 - 16_000
// Each turn's text is about 4k tokens, so a summary keeps the last five turns of 20k tokens.
const FILLER = ' filler'.repeat(2_000)

afterEach(() => vi.restoreAllMocks())

async function waitForAnswer(agentId: string, requestId: string) {
  await expect
    .poll(
      async () => {
        using result = await exports.default.submission(agentId, requestId)
        return result?.submission.status
      },
      { timeout: 10_000 },
    )
    .toBe('done')
}

/**
 * Scripted model: answers that report `usage(n)` for the n-th answer request, summaries that wait
 * for `gate()`, and declined memory jobs.
 */
function mockModel(options: {
  usage: (n: number) => number
  gate?: () => Promise<void> | undefined
  memory?: (body: string) => Response
}) {
  const bodies: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    const body = requestBody(init)
    if (isMemoryAgentRequest(body)) {
      if (options.memory !== undefined) return options.memory(body)
      return toolResults(body) === 0
        ? toolCallResponse({ name: 'memory_decline', arguments: { reason: 'test' } })
        : textResponse('Declined.')
    }
    if (isSummaryRequest(body)) {
      await options.gate?.()
      return textResponse('Summary: the user set a codename and talked at length.')
    }
    bodies.push(body)
    return textResponse('OK', options.usage(bodies.length - 1))
  })
  return bodies
}

async function say(agentId: string, requestId: string, content: string) {
  await exports.default.sendMessage(agentId, { requestId, content })
  await waitForAnswer(agentId, requestId)
}

/** Answer 7 reports a full context, so Pi compacts before answer 8. */
const COMPACT_AFTER_TURN_7 = (n: number) => (n === 7 ? BLOCKING_USAGE : 5)

/** Seven long turns, then one that compacts: entries before the summary's head can be pruned. */
async function compactedAgent(agentId: string, codename: string) {
  await say(agentId, 't0', `The codename is ${codename}.${FILLER}`)
  for (let turn = 1; turn < 7; turn++) await say(agentId, `t${turn}`, `Turn ${turn}.${FILLER}`)
  await say(agentId, 'big', `Turn 7.${FILLER}`)
  await say(agentId, 'compacts', 'Turn 8.')
}

function headOf(agentId: string): Promise<number | undefined> {
  return runInDurableObject(env.AGENTS.getByName(agentId), (_instance, state) => {
    const row = drizzle(state.storage)
      .select({ head: piEntries.head })
      .from(piEntries)
      .orderBy(piEntries.id)
      .all()
      .findLast((entry) => entry.head !== null)
    return row?.head ?? undefined
  })
}

function storedEntryIds(agentId: string): Promise<number[]> {
  return runInDurableObject(env.AGENTS.getByName(agentId), (_instance, state) =>
    drizzle(state.storage)
      .select({ id: piEntries.id })
      .from(piEntries)
      .all()
      .map((row) => row.id),
  )
}

describe('pruning', () => {
  it('archives the entries before the newest head, deletes them, and the conversation goes on', async () => {
    const agentId = crypto.randomUUID()
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
      env.MEMORY_AGENT.getByName(MEMORY_AGENT_NAME),
      async (_i, state) => {
        const local = await openLocalDb(state.storage)
        return local.select({ kind: memoryJobs.kind }).from(memoryJobs).all()
      },
    )
    expect(jobs.map((job) => job.kind)).toContain('record_archive')
  })

  it('summarizes an archived segment through the memory agent and finds the summary', async () => {
    const agentId = crypto.randomUUID()
    const summary = `Summary: the release train ${agentId.slice(0, 6)} was agreed`
    mockModel({
      usage: COMPACT_AFTER_TURN_7,
      memory: (body) => {
        const step = toolResults(body)
        if (!body.includes('Job: record_archive')) {
          return step === 0
            ? toolCallResponse({ name: 'memory_decline', arguments: { reason: 'test' } })
            : textResponse('Declined.')
        }
        if (step === 0) return toolCallResponse({ name: 'read_archive', arguments: {} })
        if (step === 1 && body.includes('end of segment')) {
          return toolCallResponse({ name: 'write_archive_summary', arguments: { summary } })
        }
        return textResponse('Summarized.')
      },
    })
    await compactedAgent(agentId, 'summarized')

    expect(await env.AGENTS.getByName(agentId).prune({ force: true })).toBe('pruned')

    const hasSummary = async () => {
      const segment = await db
        .select({ hasSummary: archiveSegments.hasSummary })
        .from(archiveSegments)
        .where(eq(archiveSegments.agentId, agentId))
        .get()
      return segment?.hasSummary
    }
    await expect.poll(hasSummary, { timeout: 10_000 }).toBe(true)
    const found = await searchHistory(db, env.ARCHIVE, agentId, 'release train')
    expect(found.summaries.map((hit) => hit.summary)).toEqual([summary])
  })

  it('defers the delete while a background compaction runs, then finishes it', async () => {
    const agentId = crypto.randomUUID()
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
    const agentId = crypto.randomUUID()
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
    const agentId = crypto.randomUUID()
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
    const agentId = crypto.randomUUID()
    const stub = env.AGENTS.getByName(agentId)
    await runInDurableObject(stub, (_i, state) =>
      state.storage.put(PRUNE_LIMITS_KEY, { hardBytes: 0 }),
    )

    const error = await exports.default
      .sendMessage(agentId, { requestId: 'refused', content: 'Hello' })
      .then(
        () => undefined,
        (reason: unknown) => String(reason),
      )

    expect(error).toContain(STORAGE_MAINTENANCE_ERROR)
    expect(
      await runInDurableObject(stub, (_i, state) => state.storage.get('kodama:alarm:prune')),
    ).toBeDefined()
    // The alarm finds nothing to prune in an empty conversation and clears itself.
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect(
      await runInDurableObject(stub, (_i, state) => state.storage.get('kodama:alarm:prune')),
    ).toBeUndefined()
  })
})

describe('memory agent pruning', () => {
  it('deletes its finished jobs without an archive', async () => {
    mockModel({ usage: () => 5 })
    const stub = env.MEMORY_AGENT.getByName(MEMORY_AGENT_NAME)
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
