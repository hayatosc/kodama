/**
 * Behavior of Pi Durable 1.2.0 that the harness and the long-term memory design rely on
 * (docs/memory.md, Pi Durable assumptions). Run these again on every Pi upgrade.
 *
 * @module
 */
import { env } from 'cloudflare:workers'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Harness } from '@earendil-works/pi-durable'
import { afterEach, expect, it, vi } from 'vitest'
import { withHarness } from '../helper/harness.ts'
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
  const model = createAgentModels().getModel(env.DEFAULT_MODEL_PROVIDER, env.DEFAULT_MODEL_ID)
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
