import { expect, it } from 'vitest'
import { printStream } from './stream.ts'

function stream(events: unknown[]): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
  )
  return new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
      controller.close()
    },
  })
}

it('renders text across UTF-8 and SSE boundaries without leaking thinking', async () => {
  let output = ''
  await printStream(
    stream([
      {
        type: 'message_update',
        changes: [
          { type: 'thinking_delta', delta: 'private' },
          { type: 'text_delta', delta: 'こんにちは' },
        ],
      },
      { type: 'submission', record: { status: 'done' } },
    ]),
    (text) => {
      output += text
    },
  )
  expect(output).toBe('こんにちは\n')
})

it('rejects model failure and interrupted streams', async () => {
  await expect(
    printStream(
      stream([{ type: 'submission', record: { status: 'unanswered', reason: 'model_error' } }]),
      () => {},
    ),
  ).rejects.toThrow(/model_error/)
  await expect(printStream(stream([]), () => {})).rejects.toThrow(/before completion/)
})

it('prints JSON events for debugging and accepts completed retries', async () => {
  let output = ''
  const event = { type: 'submission', record: { status: 'done' } }
  await printStream(
    stream([event]),
    (text) => {
      output += text
    },
    true,
  )
  expect(JSON.parse(output)).toEqual(event)
})

function assistant(text: string) {
  return {
    role: 'assistant',
    content: [
      { type: 'text', text },
      { type: 'thinking', thinking: 'private' },
    ],
  }
}

it('renders a complete message delivered without text deltas exactly once', async () => {
  let output = ''
  await printStream(
    stream([
      { type: 'message_start', message: assistant('CLI_OK') },
      { type: 'message_end', entry: { id: 11, model: [assistant('CLI_OK')] } },
      { type: 'submission', record: { status: 'done', answer: 11 } },
    ]),
    (text) => {
      output += text
    },
  )
  expect(output).toBe('CLI_OK\n')
})

it('recovers missing text from the committed message without duplicating deltas', async () => {
  let output = ''
  await printStream(
    stream([
      { type: 'message_start', message: assistant('') },
      { type: 'message_update', changes: [{ type: 'text_delta', delta: 'CLI_' }] },
      { type: 'message_end', entry: { id: 11, model: [assistant('CLI_OK')] } },
      { type: 'submission', record: { status: 'done', answer: 11 } },
    ]),
    (text) => {
      output += text
    },
  )
  expect(output).toBe('CLI_OK\n')
})

it('replays the requested answer, not the latest answer in the snapshot', async () => {
  let output = ''
  await printStream(
    stream([
      {
        type: 'snapshot',
        entries: [
          { id: 11, model: [assistant('requested answer')] },
          { id: 15, model: [assistant('unrelated later answer')] },
        ],
      },
      { type: 'submission', record: { status: 'done', answer: 11 } },
    ]),
    (text) => {
      output += text
    },
  )
  expect(output).toBe('requested answer\n')
})
