import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { Harness } from '@earendil-works/pi-durable'
import { openDurableObjectSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/cloudflare'
import { describe, expect, it, vi } from 'vitest'
import { createAgentOptions } from './harness.ts'
import { decodeEvents, modelResponse, useMockModel, waitForAnswer } from './testing/rpc.ts'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'

useMockModel()

describe('agent failures, cancellation, and recovery', () => {
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
})
