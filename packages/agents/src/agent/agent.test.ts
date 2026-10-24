import { evictDurableObject, runInDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { newAgentId } from '../helper/control.ts'
import { parseMessage } from '../validation.ts'
import { useMockModel, waitForAnswer } from '../helper/rpc.ts'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'

useMockModel()

describe('agent RPC', () => {
  it('generates an answer through Worker and Durable Object RPC and persists it across eviction', async () => {
    const agentId = await newAgentId()
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
    // Recovery stops once the answer is done; the extraction alarm stays for the idle agent.
    await expect
      .poll(() =>
        runInDurableObject(stub, (_instance, state) =>
          state.storage.get<number>('kodama:alarm:recovery'),
        ),
      )
      .toBeUndefined()
    accepted[Symbol.dispose]()
    before[Symbol.dispose]()
    await evictDurableObject(stub)
    expect(await exports.default.snapshot(agentId)).toEqual(before)
    const retried = await exports.default.sendMessage(agentId, message)
    expect(retried.submissionId).toBe(accepted.submissionId)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('isolates agents and deduplicates concurrent sends', async () => {
    const agentId = await newAgentId()
    const message = { requestId: 'same', content: 'Remember this' }
    const [first, second] = await Promise.all([
      exports.default.sendMessage(agentId, message),
      exports.default.sendMessage(agentId, message),
    ])
    expect(first.submissionId).toBe(second.submissionId)
    await waitForAnswer(agentId, 'same')
    const otherId = await newAgentId()
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
    const receiverId = await newAgentId()
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
})

it('serves no configuration through AgentService; AdminService owns it', async () => {
  const agentId = await newAgentId()
  const call = (method: 'getConfig' | 'setConfig') =>
    // @ts-expect-error AgentService has no configuration methods.
    Promise.resolve(exports.default[method](agentId, {})).then(
      () => 'served',
      (error: unknown) => String(error),
    )
  expect(await call('getConfig')).not.toBe('served')
  expect(await call('setConfig')).not.toBe('served')
})
