/** Usage is captured at Pi's result boundary, including compaction's completeSimple. @module */
import { runInDurableObject, evictDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { afterEach, expect, it, vi } from 'vitest'
import { usage } from '../../drizzle/durable-object/schema.ts'
import { createCredentialStore } from '../credentials/store.ts'
import { newAgentId, desiredSettings } from '../helper/management.ts'
import { textResponse, toolCallResponse } from '../helper/model.ts'
import { waitForAnswer } from '../helper/rpc.ts'
import { managementDb } from '../management/db.ts'
import { createAgentModels } from '../models/index.ts'
import { openLocalDb } from '../storage/local.ts'
import { usageModels } from './usage.ts'

afterEach(() => vi.restoreAllMocks())

it('records real working turns once with selected credentials across eviction', async () => {
  const id = await newAgentId()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => textResponse('Usage recorded'))
  for (const requestId of ['first', 'second']) {
    using sent = await exports.default.sendMessage(id, { requestId, content: 'Hello' })
    expect(sent.agentId).toBe(id)
    await waitForAnswer(id, requestId)
    await evictDurableObject(env.AGENTS.getByName(id))
  }
  const rows = await runInDurableObject(env.AGENTS.getByName(id), async (_, state) => {
    const local = await openLocalDb(state.storage)
    return local.select().from(usage).all()
  })
  expect(rows).toHaveLength(2)
  for (const row of rows)
    expect(row).toMatchObject({
      chargedAgentId: id,
      actorKind: 'user',
      status: 'succeeded',
      usageState: 'reported',
      credentialKind: 'api_key',
      input: 5,
      output: 4,
      totalTokens: 9,
    })
  expect(rows[0]?.credentialId).toBeTruthy()
  expect(rows[0]?.seq).not.toBe(rows[1]?.seq)
})

it('charges peer contact to the receiver rather than the sender', async () => {
  const sender = await newAgentId()
  const receiver = await newAgentId()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => textResponse('Peer reply'))
  await env.AGENTS.getByName(sender).sendTo(receiver, { requestId: 'usage-peer', content: 'Hello' })
  await waitForAnswer(receiver, 'usage-peer')
  const rows = await runInDurableObject(env.AGENTS.getByName(receiver), async (_, state) =>
    (await openLocalDb(state.storage)).select().from(usage).all(),
  )
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ chargedAgentId: receiver, actorKind: 'agent' })
})

it('keeps peer attribution when a completed user request is replayed during its tool loop', async () => {
  const sender = await newAgentId()
  const receiver = await newAgentId()
  const held = Promise.withResolvers<Response>()
  const entered = Promise.withResolvers<void>()
  let calls = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    calls += 1
    if (calls === 2) {
      entered.resolve()
      return held.promise
    }
    return textResponse('Done')
  })
  using original = await exports.default.sendMessage(receiver, {
    requestId: 'old-user',
    content: 'Hello',
  })
  await waitForAnswer(receiver, 'old-user')
  await env.AGENTS.getByName(sender).sendTo(receiver, { requestId: 'peer-loop', content: 'Time?' })
  await entered.promise
  try {
    using replay = await exports.default.sendMessage(receiver, {
      requestId: 'old-user',
      content: 'Hello',
    })
    expect(replay.submissionId).toBe(original.submissionId)
  } finally {
    held.resolve(toolCallResponse({ name: 'current_time', arguments: {} }))
  }
  await waitForAnswer(receiver, 'peer-loop')
  const rows = await runInDurableObject(env.AGENTS.getByName(receiver), async (_, state) =>
    (await openLocalDb(state.storage)).select().from(usage).all(),
  )
  expect(rows.map((row) => row.actorKind)).toEqual(['user', 'agent', 'agent'])
})

it('counts completeSimple once and separate outer retries separately, preserving all events', async () => {
  const id = await newAgentId()
  const settings = await desiredSettings(id)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => textResponse('Summary', 20))
  await runInDurableObject(env.AGENTS.getByName(id), async (_, state) => {
    const local = await openLocalDb(state.storage)
    const credential = createCredentialStore(
      managementDb(env.MANAGEMENT_DB),
      async () => id,
      async () => settings,
      () => env.CREDENTIAL_KEK_V1,
    )
    const models = usageModels(
      createAgentModels(),
      local,
      async () => ({ chargedAgentId: id, actorKind: 'system' }),
      credential.scoped,
      () => {
        throw new Error('Unexpected storage failure')
      },
    )
    const model = models.getModel('openai', 'gpt-4o-mini')
    if (!model) throw new Error('Missing test model')
    const context = {
      messages: [{ role: 'user', content: 'Summarize', timestamp: Date.now() } as const],
    }
    const message = await models.completeSimple(model, context)
    expect(message.stopReason).toBe('stop')
    const stream = models.streamSimple(model, context)
    const events = []
    for await (const event of stream) events.push(event.type)
    expect(events).toContain('text_delta')
    expect(events.at(-1)).toBe('done')
    expect((await stream.result()).usage.input).toBe(20)
    const rows = local.select().from(usage).all()
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.input)).toEqual([20, 20])
    expect(rows.every((row) => row.credentialId && row.totalCost !== null)).toBe(true)
  })
})
