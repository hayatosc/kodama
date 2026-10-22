/**
 * Helpers of the agent RPC tests: a scripted default model and SSE readers.
 *
 * @module
 */
import { exports } from 'cloudflare:workers'
import { afterEach, beforeEach, expect, vi } from 'vitest'

/** The SSE text of a model answer of `text`. */
export function modelResponseText(text = 'Hello from Kodama'): string {
  const item = {
    type: 'message',
    id: 'msg_test',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }],
  }
  const events = [
    { type: 'response.created', response: { id: 'resp_test' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: text },
    { type: 'response.output_item.done', output_index: 0, item },
    {
      type: 'response.completed',
      response: {
        id: 'resp_test',
        status: 'completed',
        output: [item],
        usage: { input_tokens: 5, output_tokens: 4, total_tokens: 9 },
      },
    },
  ]
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
}

/** A model answer of `text`. */
export function modelResponse(text = 'Hello from Kodama'): Response {
  return new Response(modelResponseText(text), { headers: { 'Content-Type': 'text/event-stream' } })
}

/** Wait until the submission of `requestId` is done. */
export async function waitForAnswer(agentId: string, requestId: string) {
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

/** Every model request answers `Hello from Kodama` unless a test mocks fetch itself. */
export function useMockModel(): void {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => modelResponse())
  })
  afterEach(() => vi.restoreAllMocks())
}

/** Read SSE events from a stream one at a time. */
export function readEvents(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  return {
    cancel: () => reader.cancel(),
    async next(): Promise<{ type: string; data: unknown }> {
      while (!buffer.includes('\n\n')) {
        const chunk = await reader.read()
        if (chunk.done) throw new Error('Event stream ended unexpectedly')
        buffer += decoder.decode(chunk.value, { stream: true })
      }
      const boundary = buffer.indexOf('\n\n')
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const type = frame
        .split('\n')
        .find((line) => line.startsWith('event: '))
        ?.slice(7)
      const data = frame
        .split('\n')
        .find((line) => line.startsWith('data: '))
        ?.slice(6)
      if (!type || !data) throw new Error('Invalid SSE frame')
      return { type, data: JSON.parse(data) }
    },
  }
}

/** Decode a whole SSE text into its events. */
export function decodeEvents(text: string): { type: string; data: unknown }[] {
  return text
    .trim()
    .split('\n\n')
    .map((frame) => {
      const lines = frame.split('\n')
      const type = lines.find((line) => line.startsWith('event: '))?.slice(7)
      const data = lines.find((line) => line.startsWith('data: '))?.slice(6)
      if (!type || !data) throw new Error('Invalid SSE frame')
      return { type, data: JSON.parse(data) }
    })
}
