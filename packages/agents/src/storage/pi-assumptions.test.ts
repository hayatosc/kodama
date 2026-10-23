/**
 * Behavior of Pi Durable 1.2.0 and D1 that the long-term memory design relies on
 * (docs/memory.md, Pi Durable assumptions). Run these again on every Pi upgrade.
 */
import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { Harness } from '@earendil-works/pi-durable'
import type { HarnessOptions } from '@earendil-works/pi-durable'
import { openDurableObjectSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/cloudflare'
import { inArray } from 'drizzle-orm'
import { afterEach, expect, it, vi } from 'vitest'
import { createAgentOptions } from '../agent/harness.ts'
import { memoryDb } from '../memory/store/db.ts'
import { memoryOps } from '../../drizzle/d1/schema.ts'
import { createAgentModels } from '../models/index.ts'
// Load the provider before Durable Object work so Vite's module fetch is outside it.
import '@earendil-works/pi-ai/api/openai-responses'

const context = BACKGROUND_CONTEXT

function modelResponse(text: string, inputTokens = 5): Response {
  const item = {
    type: 'message',
    id: 'msg_test',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }],
  }
  const usage = { input_tokens: inputTokens, output_tokens: 4, total_tokens: inputTokens + 4 }
  const events = [
    { type: 'response.created', response: { id: 'resp_test' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: text },
    { type: 'response.output_item.done', output_index: 0, item },
    {
      type: 'response.completed',
      response: { id: 'resp_test', status: 'completed', output: [item], usage },
    },
  ]
  const body = events
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('')
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
}

/** Summarization requests carry the transcript in a `<conversation>` block. */
function isSummaryRequest(body: string): boolean {
  return body.includes('<conversation>')
}

function requestBody(init: RequestInit | undefined): string {
  return typeof init?.body === 'string' ? init.body : ''
}

/**
 * Open a Harness on a fresh object's storage. The object's own `Agent` harness stays passive:
 * nothing is submitted through it, so only this harness schedules work.
 */
async function withHarness<T>(
  settings: HarnessOptions['settings'],
  run: (harness: Harness) => Promise<T>,
): Promise<T> {
  const stub = env.AGENTS.getByName(crypto.randomUUID())
  return runInDurableObject(stub, async (_instance, state) => {
    const options = createAgentOptions(env)
    const storage = await openDurableObjectSqliteStorage(state.storage)
    const harness = await Harness.open(
      storage,
      { ...options, settings: { ...options.settings, ...settings } },
      context,
    )
    try {
      return await run(harness)
    } finally {
      await harness.close(context)
    }
  })
}

async function answer(harness: Harness, requestId: string, content: string): Promise<void> {
  const root = await harness.root(context)
  const submission = await root.submit(
    { type: 'input', requestId, content, whenBusy: 'followUp' },
    context,
  )
  expect(await submission.wait(context)).toMatchObject({ status: 'done' })
}

afterEach(() => vi.restoreAllMocks())

it('reports a running background compaction as a live task while the conversation is idle', async () => {
  let summaryRequests = 0
  let releaseSummary = (): void => {}
  const summaryGate = new Promise<void>((resolve) => {
    releaseSummary = resolve
  })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    if (!isSummaryRequest(requestBody(init))) return modelResponse('ok', 1_500)
    summaryRequests += 1
    await summaryGate
    return modelResponse('SUMMARY')
  })
  const model = createAgentModels(env).getModel(env.DEFAULT_MODEL_PROVIDER, env.DEFAULT_MODEL_ID)
  if (model === undefined) throw new Error('Default model is missing from the catalog')
  // Background compaction starts above contextWindow - reserveTokens - backgroundTokens = 1,000.
  const compaction = {
    enabled: true,
    reserveTokens: 1_000,
    keepRecentTokens: 1,
    backgroundTokens: model.contextWindow - 2_000,
  }

  const live = await withHarness({ compaction }, async (harness) => {
    await answer(harness, 'first', 'alpha')
    await answer(harness, 'second', 'beta')
    const root = await harness.root(context)
    await root.waitForIdle(context)
    const { tasks } = await harness.inspect(context)
    releaseSummary()
    return tasks.map((task) => ({ background: task.record.background, kind: task.state.kind }))
  })

  // The idle wait returned while the summary request was still held open.
  expect(summaryRequests).toBe(1)
  expect(live).toContainEqual(expect.objectContaining({ background: true }))
})

it('runs input submitted after an idle reset without the earlier context', async () => {
  const bodies: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    bodies.push(requestBody(init))
    return modelResponse('ok')
  })

  await withHarness(undefined, async (harness) => {
    await answer(harness, 'first', 'first-job-marker')
    const root = await harness.root(context)
    await root.reset(undefined, context)
    await answer(harness, 'second', 'second-job-marker')
  })

  const last = bodies.at(-1) ?? ''
  expect(last).toContain('second-job-marker')
  expect(last).not.toContain('first-job-marker')
})

it('rolls back every statement of a D1 batch when one statement fails', async () => {
  const db = memoryDb(env.MEMORY_DB)
  const [a, b] = [crypto.randomUUID(), crypto.randomUUID()]
  const op = (opId: string) =>
    db
      .insert(memoryOps)
      .values({ opId, jobId: 'batch', op: 'test', resultJson: '{}', appliedAt: 0 })

  await expect(db.batch([op(a), op(b), op(a)])).rejects.toThrow()

  const stored = await db
    .select()
    .from(memoryOps)
    .where(inArray(memoryOps.opId, [a, b]))
  expect(stored).toEqual([])
})
