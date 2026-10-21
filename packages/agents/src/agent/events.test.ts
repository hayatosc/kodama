import { exports } from 'cloudflare:workers'
import { expect, it, vi } from 'vitest'
import {
  decodeEvents,
  modelResponse,
  modelResponseText,
  readEvents,
  useMockModel,
  waitForAnswer,
} from '../testing/rpc.ts'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'

useMockModel()

it('streams an initial snapshot', async () => {
  const stream = await exports.default.subscribe(crypto.randomUUID())
  const reader = stream.getReader()
  const chunk = await reader.read()
  expect(new TextDecoder().decode(chunk.value)).toContain('event: snapshot')
  await reader.cancel()
})

it('streams generation, completion and reconnect state without polling', async () => {
  const agentId = crypto.randomUUID()
  const events = readEvents(await exports.default.subscribe(agentId))
  const other = readEvents(await exports.default.subscribe(agentId))
  try {
    expect((await events.next()).type).toBe('snapshot')
    expect((await other.next()).type).toBe('snapshot')
    await other.cancel()
    const body = modelResponseText()
    const boundary = body.indexOf('event: response.output_item.done')
    let sentSecondDelta = false
    vi.mocked(fetch).mockImplementation(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  body.slice(0, boundary).replace('"delta":"Hello from Kodama"', '"delta":"Hello"'),
                ),
              )
            },
            async pull(controller) {
              await new Promise((resolve) => setTimeout(resolve, 200))
              if (!sentSecondDelta) {
                sentSecondDelta = true
                controller.enqueue(
                  new TextEncoder().encode(
                    'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":" from Kodama"}\n\n',
                  ),
                )
              } else {
                controller.enqueue(new TextEncoder().encode(body.slice(boundary)))
                controller.close()
              }
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
    )
    const chat = new Response(
      await exports.default.send(agentId, { requestId: 'sse', content: 'Hello' }),
    ).text()
    const received: string[] = []
    let event = await events.next()
    while (event.type !== 'submission' || !JSON.stringify(event.data).includes('"done"')) {
      received.push(event.type)
      event = await events.next()
    }
    const chatEvents = decodeEvents(await chat)
    expect(chatEvents.map((event) => event.type)).toContain('message_update')
    expect(chatEvents.at(-1)).toMatchObject({
      type: 'submission',
      data: { record: { status: 'done' } },
    })
    expect(received).toContain('message_update')
    expect(received).toContain('message_end')
    await events.cancel()
    const reconnect = readEvents(await exports.default.subscribe(agentId))
    try {
      const initial = await reconnect.next()
      expect(initial.type).toBe('snapshot')
      expect(JSON.stringify(initial.data)).toContain('Hello from Kodama')
    } finally {
      await reconnect.cancel()
    }
  } finally {
    await events.cancel()
    await other.cancel()
  }
})

it('sends and streams to completion in one RPC, including completed retries', async () => {
  const agentId = crypto.randomUUID()
  const message = { requestId: 'unified', content: 'Hello' }
  const events = decodeEvents(
    await new Response(await exports.default.send(agentId, message)).text(),
  )
  expect(events[0]).toMatchObject({ type: 'accepted', data: { requestId: 'unified' } })
  expect(events.at(-1)).toMatchObject({
    type: 'submission',
    data: { record: { requestId: 'unified', status: 'done' } },
  })
  expect(JSON.stringify(events)).toContain('Hello from Kodama')
  const calls = vi.mocked(fetch).mock.calls.length
  const retry = decodeEvents(
    await new Response(await exports.default.send(agentId, message)).text(),
  )
  expect(retry.map((event) => event.type)).toEqual(['accepted', 'snapshot', 'submission'])
  expect(JSON.stringify(retry)).toContain('Hello from Kodama')
  expect(vi.mocked(fetch).mock.calls.length).toBe(calls)
})

it.each([undefined, 'followUp', 'steer'] as const)(
  'preserves the requested busy mode %s through streaming RPC',
  async (whenBusy) => {
    const agentId = crypto.randomUUID()
    const started = Promise.withResolvers<void>()
    const response = Promise.withResolvers<Response>()
    vi.mocked(fetch).mockImplementationOnce(async () => {
      started.resolve()
      return response.promise
    })
    await exports.default.sendMessage(agentId, { requestId: 'first', content: 'First' })
    await started.promise
    try {
      const stream = await exports.default.send(agentId, {
        requestId: 'second',
        content: 'Second',
        ...(whenBusy === undefined ? {} : { whenBusy }),
      })
      const events = readEvents(stream)
      try {
        expect((await events.next()).type).toBe('accepted')
        const observer = readEvents(await exports.default.subscribe(agentId))
        try {
          expect(await observer.next()).toMatchObject({
            type: 'snapshot',
            data: { inbox: [expect.objectContaining({ mode: whenBusy ?? 'followUp' })] },
          })
        } finally {
          await observer.cancel()
        }
      } finally {
        await events.cancel()
      }
    } finally {
      response.resolve(modelResponse())
    }
    await waitForAnswer(agentId, 'first')
    await waitForAnswer(agentId, 'second')
  },
)

it('isolates queued send streams and closes each at its own terminal submission', async () => {
  const agentId = crypto.randomUUID()
  let calls = 0
  vi.mocked(fetch).mockImplementation(async () => {
    calls += 1
    await new Promise((resolve) => setTimeout(resolve, 100))
    return modelResponse(`answer-${calls}`)
  })
  const first = await exports.default.send(agentId, { requestId: 'first', content: 'First' })
  const second = await exports.default.send(agentId, { requestId: 'second', content: 'Second' })
  const results = await Promise.all([new Response(first).text(), new Response(second).text()])
  const firstEvents = decodeEvents(results[0] ?? '').filter((event) => event.type !== 'snapshot')
  const secondEvents = decodeEvents(results[1] ?? '').filter((event) => event.type !== 'snapshot')
  expect(JSON.stringify(firstEvents)).toContain('answer-1')
  expect(JSON.stringify(firstEvents)).not.toContain('answer-2')
  expect(JSON.stringify(secondEvents)).toContain('answer-2')
  expect(JSON.stringify(secondEvents)).not.toContain('answer-1')
  expect(firstEvents.at(-1)).toMatchObject({
    data: { record: { requestId: 'first', status: 'done' } },
  })
  expect(secondEvents.at(-1)).toMatchObject({
    data: { record: { requestId: 'second', status: 'done' } },
  })
})

it('closes a send stream with an unanswered receipt on provider failure', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('Unauthorized', { status: 401 }))
  const stream = await exports.default.send(crypto.randomUUID(), {
    requestId: 'failed',
    content: 'Hello',
  })
  const events = decodeEvents(await new Response(stream).text())
  expect(events.at(-1)).toMatchObject({
    type: 'submission',
    data: { record: { status: 'unanswered' } },
  })
})
