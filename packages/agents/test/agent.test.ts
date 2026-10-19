import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { Harness } from '@earendil-works/pi-durable'
import { openDurableObjectSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/cloudflare'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentOptions } from '../src/harness.ts'
import { parseMessage } from '../src/validation.ts'
import { handleCli } from '../cli/handler.ts'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'

it('authenticates the CLI adapter and sends through real Durable Object RPC', async () => {
  const agentId = crypto.randomUUID()
  const url = `http://localhost/cli/send/${agentId}`
  const message = { requestId: 'cli-send', content: 'Hello from CLI' }
  const denied = await handleCli(
    new Request(url, { method: 'POST' }),
    'test-token',
    exports.default,
  )
  expect(denied.status).toBe(401)
  expect((await exports.default.snapshot(agentId)).snapshot.messages).toEqual([])
  const response = await handleCli(
    new Request(url, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify(message),
    }),
    'test-token',
    exports.default,
  )
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('text/event-stream')
  const events = decodeEvents(await response.text())
  expect(events.at(-1)).toMatchObject({ type: 'submission', data: { record: { status: 'done' } } })
  expect(JSON.stringify(events)).toContain('Hello from Kodama')
  const snapshot = await handleCli(
    new Request(`http://localhost/cli/snapshot/${agentId}`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token' },
    }),
    'test-token',
    exports.default,
  )
  expect(await snapshot.text()).toContain('Hello from CLI')
  const cancelled = await handleCli(
    new Request(`http://localhost/cli/cancel/${agentId}`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token' },
    }),
    'test-token',
    exports.default,
  )
  expect(await cancelled.json()).toEqual({ cancelled: true })
})

it('rejects malformed CLI input before RPC admission', async () => {
  const response = await handleCli(
    new Request('http://localhost/cli/send/test', {
      method: 'POST',
      headers: { authorization: 'Bearer test-token' },
      body: '{}',
    }),
    'test-token',
    exports.default,
  )
  expect(response.status).toBe(400)
})

function modelResponseText(text = 'Hello from Kodama'): string {
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

function modelResponse(text = 'Hello from Kodama'): Response {
  return new Response(modelResponseText(text), { headers: { 'Content-Type': 'text/event-stream' } })
}

async function waitForAnswer(agentId: string, requestId: string) {
  await expect
    .poll(
      async () => {
        using result = await exports.default.submission(agentId, requestId)
        return result?.submission.status
      },
      {
        timeout: 5000,
      },
    )
    .toBe('done')
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => modelResponse())
})

afterEach(() => vi.restoreAllMocks())

describe('agent RPC', () => {
  it('generates an answer through Worker and Durable Object RPC and persists it across eviction', async () => {
    const agentId = crypto.randomUUID()
    const message = { requestId: 'first', content: 'Hello' }
    const accepted = await exports.default.sendMessage(agentId, message)
    expect(accepted).toMatchObject({ agentId, requestId: 'first' })
    await waitForAnswer(agentId, 'first')
    const before = await exports.default.snapshot(agentId)
    expect(before.snapshot.messages).toEqual([
      expect.objectContaining({ role: 'user', text: 'Hello' }),
      expect.objectContaining({ role: 'assistant', text: 'Hello from Kodama' }),
    ])
    const stub = env.AGENTS.getByName(agentId)
    await expect
      .poll(() => runInDurableObject(stub, (_instance, state) => state.storage.getAlarm()))
      .toBeNull()
    accepted[Symbol.dispose]()
    before[Symbol.dispose]()
    await evictDurableObject(stub)
    expect(await exports.default.snapshot(agentId)).toEqual(before)
    const retried = await exports.default.sendMessage(agentId, message)
    expect(retried.submissionId).toBe(accepted.submissionId)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('isolates agents and deduplicates concurrent sends', async () => {
    const agentId = crypto.randomUUID()
    const message = { requestId: 'same', content: 'Remember this' }
    const [first, second] = await Promise.all([
      exports.default.sendMessage(agentId, message),
      exports.default.sendMessage(agentId, message),
    ])
    expect(first.submissionId).toBe(second.submissionId)
    await waitForAnswer(agentId, 'same')
    const otherId = crypto.randomUUID()
    expect((await exports.default.snapshot(otherId)).snapshot.messages).toEqual([])
    expect(await exports.default.submission(otherId, 'same')).toBeUndefined()
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid input through service and direct object RPC', async () => {
    await expect(Promise.resolve(exports.default.snapshot('../invalid'))).rejects.toThrow('agentId')
    const stub = env.AGENTS.getByName(crypto.randomUUID())
    await expect(
      Promise.resolve(stub.sendMessage({ requestId: '', content: 'hello' })),
    ).rejects.toThrow('requestId')
    await expect(
      Promise.resolve(stub.sendMessage({ requestId: 'blank', content: '  ' })),
    ).rejects.toThrow('content')
    await expect(
      Promise.resolve(stub.sendMessage({ requestId: 'large', content: 'x'.repeat(16_001) })),
    ).rejects.toThrow('content')
    expect(() => parseMessage({ requestId: 'mode', content: 'Hello', whenBusy: 'reject' })).toThrow(
      'whenBusy',
    )
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('delivers from one agent to another through Durable Object RPC', async () => {
    const senderId = crypto.randomUUID()
    const receiverId = crypto.randomUUID()
    const sender = env.AGENTS.getByName(senderId)
    await sender.sendTo(receiverId, {
      requestId: 'delegated',
      content: 'Hello from another agent',
      whenBusy: 'steer',
    })
    await waitForAnswer(receiverId, 'delegated')
    expect((await sender.snapshot()).messages).toEqual([])
    expect((await exports.default.snapshot(receiverId)).snapshot.messages[0]?.text).toBe(
      'Hello from another agent',
    )
  })

  it('reports provider failure as a settled unanswered submission', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async () =>
      Response.json(
        {
          error: {
            message: 'Invalid API key',
            type: 'invalid_request_error',
            code: 'invalid_api_key',
          },
        },
        { status: 401 },
      ),
    )
    const agentId = crypto.randomUUID()
    await exports.default.sendMessage(agentId, { requestId: 'failed', content: 'Hello' })
    await expect
      .poll(async () => (await exports.default.submission(agentId, 'failed'))?.submission.status)
      .toBe('unanswered')
    const result = await exports.default.submission(agentId, 'failed')
    expect(result?.submission).toMatchObject({
      status: 'unanswered',
      reason: 'model_error',
      detail: expect.stringContaining('Invalid API key'),
    })
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('waits out transient provider failures and retries until an answer arrives', async () => {
    vi.mocked(globalThis.fetch).mockImplementationOnce(async () =>
      Response.json(
        { error: { message: 'The server is overloaded', type: 'server_error' } },
        { status: 503 },
      ),
    )
    const agentId = crypto.randomUUID()
    await exports.default.sendMessage(agentId, { requestId: 'retried', content: 'Hello' })
    await expect
      .poll(async () => (await exports.default.submission(agentId, 'retried'))?.submission.status, {
        timeout: 10_000,
      })
      .toBe('done')
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  it('cancels a retrying run and its queued input, then accepts new work', async () => {
    const failed = Promise.withResolvers<void>()
    vi.mocked(globalThis.fetch).mockImplementation(async () => {
      failed.resolve()
      return Response.json({ error: { message: 'Overloaded' } }, { status: 503 })
    })
    const agentId = crypto.randomUUID()
    using original = await exports.default.getConfig(agentId)
    await exports.default.sendMessage(agentId, { requestId: 'stuck', content: 'First' })
    await exports.default.sendMessage(agentId, { requestId: 'queued', content: 'Second' })
    await failed.promise
    await exports.default.cancel(agentId)
    for (const requestId of ['stuck', 'queued']) {
      expect((await exports.default.submission(agentId, requestId))?.submission.status).toBe(
        'unanswered',
      )
    }
    expect((await exports.default.snapshot(agentId)).snapshot.busy).toBe(false)
    await exports.default.setConfig(agentId, { ...original, systemPrompt: 'Changed' })
    vi.mocked(globalThis.fetch).mockImplementation(async () => modelResponse())
    await exports.default.sendMessage(agentId, { requestId: 'after', content: 'Third' })
    await waitForAnswer(agentId, 'after')
  })

  it('cancels a generation while the model request is in flight', async () => {
    const started = Promise.withResolvers<void>()
    vi.mocked(globalThis.fetch).mockImplementationOnce(async (_input, init) => {
      started.resolve()
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException('Aborted', 'AbortError'))
        if (init?.signal?.aborted) abort()
        else init?.signal?.addEventListener('abort', abort, { once: true })
      })
    })
    const agentId = crypto.randomUUID()
    const text = new Response(
      await exports.default.send(agentId, { requestId: 'inflight', content: 'Hello' }),
    ).text()
    await started.promise
    await exports.default.cancel(agentId)
    const events = decodeEvents(await text)
    expect(events.at(-1)).toMatchObject({
      type: 'submission',
      data: { record: { requestId: 'inflight', status: 'unanswered' } },
    })
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('resumes an interrupted generation from SQLite when an alarm wakes the object', async () => {
    const agentId = crypto.randomUUID()
    const stub = env.AGENTS.getByName(agentId)
    const started = Promise.withResolvers<void>()
    vi.mocked(globalThis.fetch).mockImplementationOnce(async (_input, init) => {
      started.resolve()
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException('Interrupted', 'AbortError'))
        if (init?.signal?.aborted) abort()
        else init?.signal?.addEventListener('abort', abort, { once: true })
      })
    })
    await runInDurableObject(stub, async (_instance, state) => {
      const storage = await openDurableObjectSqliteStorage(state.storage)
      const harness = await Harness.open(storage, createAgentOptions(env), BACKGROUND_CONTEXT)
      try {
        const root = await harness.root(BACKGROUND_CONTEXT)
        await root.submit(
          { type: 'input', requestId: 'recover', content: 'Finish this' },
          BACKGROUND_CONTEXT,
        )
        await state.storage.setAlarm(Date.now() + 60_000)
        await started.promise
      } finally {
        await harness.close(BACKGROUND_CONTEXT)
      }
    })
    await evictDurableObject(stub)
    await runDurableObjectAlarm(stub)
    await waitForAnswer(agentId, 'recover')
    expect((await exports.default.snapshot(agentId)).snapshot.messages).toEqual([
      expect.objectContaining({ role: 'user', text: 'Finish this' }),
      expect.objectContaining({ role: 'assistant', text: 'Hello from Kodama' }),
    ])
  })
  it('persists independent agent configuration and applies it to subsequent model requests', async () => {
    const agentId = crypto.randomUUID()
    using original = await exports.default.getConfig(agentId)
    const updated = {
      ...original,
      model: { provider: 'openai', modelId: 'gpt-6-sol' },
      systemPrompt: 'You are a research assistant. Cite evidence.',
      thinkingLevel: 'low' as const,
      tools: ['current_time'],
    }
    await exports.default.setConfig(agentId, updated)
    using other = await exports.default.getConfig(crypto.randomUUID())
    expect(other).toEqual(original)
    const stub = env.AGENTS.getByName(agentId)
    await evictDurableObject(stub)
    expect(await exports.default.getConfig(agentId)).toEqual(updated)
    await exports.default.sendMessage(agentId, { requestId: 'configured', content: 'Hello' })
    await waitForAnswer(agentId, 'configured')
    const body = vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body
    expect(typeof body).toBe('string')
    if (typeof body !== 'string') throw new Error('Missing model request body')
    expect(body).toContain('gpt-6-sol')
    expect(body).toContain(updated.systemPrompt)
    expect(body).toContain('current_time')
    expect(body).not.toContain(original.systemPrompt)
    await expect
      .poll(async () => (await exports.default.snapshot(agentId)).snapshot.busy)
      .toBe(false)
    await exports.default.setConfig(agentId, { ...updated, tools: [], systemPrompt: '' })
    await exports.default.sendMessage(agentId, { requestId: 'disabled', content: 'Again' })
    await waitForAnswer(agentId, 'disabled')
    const nextBody = vi.mocked(globalThis.fetch).mock.calls[1]?.[1]?.body
    if (typeof nextBody !== 'string') throw new Error('Missing second model request body')
    const payload: unknown = JSON.parse(nextBody)
    expect(payload).not.toHaveProperty('tools')
    expect(
      (await exports.default.snapshot(agentId)).snapshot.messages.filter((m) => m.role === 'user'),
    ).toHaveLength(2)
  })

  it('rejects invalid configuration without changing the stored configuration', async () => {
    const agentId = crypto.randomUUID()
    using original = await exports.default.getConfig(agentId)
    for (const invalid of [
      { ...original, model: { provider: 'unknown', modelId: 'unknown' } },
      { ...original, tools: ['unknown_tool'] },
      { ...original, tools: ['current_time', 'current_time'] },
      { ...original, systemPrompt: 'x'.repeat(64_001) },
    ]) {
      await expect(Promise.resolve(exports.default.setConfig(agentId, invalid))).rejects.toThrow()
      expect(await exports.default.getConfig(agentId)).toEqual(original)
    }
  })

  it('rejects configuration changes while a generation is active', async () => {
    const agentId = crypto.randomUUID()
    using original = await exports.default.getConfig(agentId)
    const started = Promise.withResolvers<void>()
    const response = Promise.withResolvers<Response>()
    vi.mocked(globalThis.fetch).mockImplementationOnce(async () => {
      started.resolve()
      return response.promise
    })
    await exports.default.sendMessage(agentId, { requestId: 'busy', content: 'Wait' })
    await started.promise
    try {
      await expect(
        Promise.resolve(
          exports.default.setConfig(agentId, { ...original, systemPrompt: 'Changed' }),
        ),
      ).rejects.toThrow('busy')
      expect(await exports.default.getConfig(agentId)).toEqual(original)
    } finally {
      response.resolve(modelResponse())
    }
    await waitForAnswer(agentId, 'busy')
  })
})

it('switches providers over RPC and keeps the selection after eviction', async () => {
  const agentId = crypto.randomUUID()
  const initial = await exports.default.getConfig(agentId)
  await exports.default.sendMessage(agentId, { requestId: 'openai', content: 'Hello' })
  await waitForAnswer(agentId, 'openai')
  await expect.poll(async () => (await exports.default.snapshot(agentId)).snapshot.busy).toBe(false)
  await exports.default.setConfig(agentId, {
    ...initial,
    model: { provider: 'xai', modelId: 'grok-4.3' },
  })
  await evictDurableObject(env.AGENTS.getByName(agentId))
  expect((await exports.default.getConfig(agentId)).model).toEqual({
    provider: 'xai',
    modelId: 'grok-4.3',
  })
  vi.mocked(fetch).mockClear()
  await exports.default.sendMessage(agentId, { requestId: 'xai', content: 'Continue' })
  await waitForAnswer(agentId, 'xai')
  const call = vi.mocked(fetch).mock.calls.at(-1)
  if (!call) throw new Error('Expected a model request')
  const request = new Request(call[0], call[1])
  expect(request.url).toBe('https://api.x.ai/v1/responses')
  expect(request.headers.get('authorization')).toBe('Bearer xai-test-key')
  expect(await request.json()).toMatchObject({ model: 'grok-4.3' })
  const state = await exports.default.snapshot(agentId)
  expect(state.snapshot.messages.filter((message) => message.role === 'user')).toHaveLength(2)
})

function readEvents(stream: ReadableStream<Uint8Array>) {
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

function decodeEvents(text: string): { type: string; data: unknown }[] {
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
