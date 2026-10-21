/**
 * Storage written by one streamed turn, the largest cost driver of a long-running agent
 * (docs/memory.md, Known limits). Budgets are measured values with headroom.
 */
import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { Harness } from '@earendil-works/pi-durable'
import { openDurableObjectSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/cloudflare'
import { afterEach, expect, it, vi } from 'vitest'
import { createAgentOptions, PROGRESS_INTERVAL_MS } from '../src/harness.ts'
// Load the provider before Durable Object work so Vite's module fetch is outside it.
import '@earendil-works/pi-ai/api/openai-responses'

const context = BACKGROUND_CONTEXT
const DELTAS = 40
const DELTA_DELAY_MS = 25
const PER_TURN_ROW_BUDGET = 140

type SseEvent = { type: string; [field: string]: unknown }

function sseEvent(event: SseEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

/** A response that streams one delta every DELTA_DELAY_MS, about one second in total. */
function slowModelResponse(): Response {
  const encoder = new TextEncoder()
  const text = Array.from({ length: DELTAS }, (_, index) => `word${index} `).join('')
  const item = {
    type: 'message',
    id: 'msg_test',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }],
  }
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: SseEvent) => controller.enqueue(encoder.encode(sseEvent(event)))
      send({ type: 'response.created', response: { id: 'resp_test' } })
      send({ type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } })
      for (let index = 0; index < DELTAS; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, DELTA_DELAY_MS))
        send({
          type: 'response.output_text.delta',
          output_index: 0,
          content_index: 0,
          delta: `word${index} `,
        })
      }
      send({ type: 'response.output_item.done', output_index: 0, item })
      send({
        type: 'response.completed',
        response: {
          id: 'resp_test',
          status: 'completed',
          output: [item],
          usage: { input_tokens: 5, output_tokens: DELTAS, total_tokens: 5 + DELTAS },
        },
      })
      controller.close()
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
}

/** Storage whose SQL cursors are kept, so rows written can be summed after a turn. */
function countingStorage(storage: DurableObjectStorage) {
  const cursors: SqlStorageCursor<Record<string, SqlStorageValue>>[] = []
  const sql = new Proxy(storage.sql, {
    get(target, property) {
      if (property === 'exec') {
        return (query: string, ...bindings: unknown[]) => {
          const cursor = target.exec(query, ...bindings)
          cursors.push(cursor)
          return cursor
        }
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const counted = new Proxy(storage, {
    get(target, property) {
      if (property === 'sql') return sql
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const rowsWritten = () => cursors.reduce((sum, cursor) => sum + cursor.rowsWritten, 0)
  return { storage: counted, rowsWritten }
}

afterEach(() => vi.restoreAllMocks())

type Turn = { rows: number; bytes: number }

/** Run three streamed turns on a fresh object and measure each one. */
async function measureTurns(progressIntervalMs: number): Promise<Turn[]> {
  const stub = env.AGENTS.getByName(crypto.randomUUID())
  return runInDurableObject(stub, async (_instance, state) => {
    const { storage, rowsWritten } = countingStorage(state.storage)
    const options = createAgentOptions(env)
    const progress = { partialIntervalMs: progressIntervalMs, outputIntervalMs: progressIntervalMs }
    const harness = await Harness.open(
      await openDurableObjectSqliteStorage(storage),
      { ...options, settings: { ...options.settings, progress } },
      context,
    )
    try {
      const root = await harness.root(context)
      const turns: Turn[] = []
      for (const requestId of ['first', 'second', 'third']) {
        const rowsBefore = rowsWritten()
        const sizeBefore = state.storage.sql.databaseSize
        const submission = await root.submit(
          { type: 'input', requestId, content: `Question ${requestId}`, whenBusy: 'followUp' },
          context,
        )
        expect(await submission.wait(context)).toMatchObject({ status: 'done' })
        turns.push({
          rows: rowsWritten() - rowsBefore,
          bytes: state.storage.sql.databaseSize - sizeBefore,
        })
      }
      return turns
    } finally {
      await harness.close(context)
    }
  })
}

it('keeps the rows written by a one-second streamed turn under the recorded budget', async () => {
  const requestBytes: number[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    requestBytes.push(typeof init?.body === 'string' ? init.body.length : 0)
    return slowModelResponse()
  })

  const atDefault = await measureTurns(PROGRESS_INTERVAL_MS)
  const atOneSecond = await measureTurns(1_000)

  console.log(JSON.stringify({ atDefault, atOneSecond, requestBytes }))
  // Measured on Pi Durable 1.2.0: about 111 rows per turn at 100 ms, with a 40-delta, one-second
  // stream. The budget leaves room for noise, not for a new write per delta.
  for (const turn of atDefault) expect(turn.rows).toBeLessThanOrEqual(PER_TURN_ROW_BUDGET)
  const total = (turns: Turn[]) => turns.reduce((sum, turn) => sum + turn.rows, 0)
  expect(total(atOneSecond)).toBeLessThan(total(atDefault))
})
