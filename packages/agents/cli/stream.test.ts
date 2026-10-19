import assert from 'node:assert/strict'
import { test } from 'node:test'
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

await test('renders text across UTF-8 and SSE boundaries without leaking thinking', async () => {
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
  assert.equal(output, 'こんにちは\n')
})

await test('rejects model failure and interrupted streams', async () => {
  await assert.rejects(
    printStream(
      stream([{ type: 'submission', record: { status: 'unanswered', reason: 'model_error' } }]),
      () => {},
    ),
    /model_error/,
  )
  await assert.rejects(
    printStream(stream([]), () => {}),
    /before completion/,
  )
})

await test('prints JSON events for debugging and accepts completed retries', async () => {
  let output = ''
  const event = { type: 'submission', record: { status: 'done' } }
  await printStream(
    stream([event]),
    (text) => {
      output += text
    },
    true,
  )
  assert.deepEqual(JSON.parse(output), event)
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

await test('renders a complete message delivered without text deltas exactly once', async () => {
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
  assert.equal(output, 'CLI_OK\n')
})

await test('recovers missing text from the committed message without duplicating deltas', async () => {
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
  assert.equal(output, 'CLI_OK\n')
})

await test('replays the requested answer, not the latest answer in the snapshot', async () => {
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
  assert.equal(output, 'requested answer\n')
})
