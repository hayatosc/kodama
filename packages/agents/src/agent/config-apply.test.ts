import { evictDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agents } from '../../drizzle/management/schema.ts'
import { reconcileAgents } from '../admin/reconcile.ts'
import { managementDb } from '../management/db.ts'
import { admin, management, newAgentId, owner, updateSettings } from '../helper/management.ts'
import { requestBody, textResponse, toolCallResponse } from '../helper/model.ts'
import { modelResponse, waitForAnswer } from '../helper/rpc.ts'
import { createAgentModels } from '../models/index.ts'
import { currentTimeTool } from '../tools/current-time.ts'
import { Agent } from './agent.ts'
// Load the provider outside short-lived DO requests.
import '@earendil-works/pi-ai/api/openai-responses'

afterEach(() => vi.restoreAllMocks())

async function versions(agentId: string) {
  const row = await management.select().from(agents).where(eq(agents.agentId, agentId)).get()
  return { desired: row?.currentVersion, applied: row?.appliedVersion }
}

function reconcile() {
  return reconcileAgents({
    env,
    db: managementDb(env.MANAGEMENT_DB),
    models: createAgentModels(env),
    principal: null,
    now: Date.now(),
  })
}

async function settled(agentId: string, requestId: string) {
  await expect
    .poll(
      async () => {
        using result = await exports.default.submission(agentId, requestId)
        return result?.submission.status
      },
      { timeout: 10_000 },
    )
    .toMatch(/^(done|unanswered)$/)
  using result = await exports.default.submission(agentId, requestId)
  return result?.submission
}

describe('a version written while a turn runs', () => {
  it('waits for idle, then applies to the next turn without a restart', async () => {
    const agentId = await newAgentId()
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<Response>()
    const bodies: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      bodies.push(requestBody(init))
      if (bodies.length > 1) return modelResponse()
      started.resolve()
      return release.promise
    })
    await exports.default.sendMessage(agentId, { requestId: 'running', content: 'First' })
    await started.promise

    const written = await updateSettings(agentId, {
      model: { provider: 'openai', modelId: 'gpt-6-sol' },
      systemPrompt: 'You are the new prompt.',
    })
    expect(written).toMatchObject({ version: 1, apply: { state: 'pending', appliedVersion: 0 } })
    expect(await admin().getAgent(await owner(), agentId)).toMatchObject({
      desiredVersion: 1,
      appliedVersion: 0,
      pending: true,
    })

    release.resolve(modelResponse())
    await waitForAnswer(agentId, 'running')
    expect(bodies[0]).not.toContain('gpt-6-sol')
    expect(bodies[0]).not.toContain('You are the new prompt.')
    await expect.poll(async () => (await versions(agentId)).applied).toBe(1)

    await exports.default.sendMessage(agentId, { requestId: 'next', content: 'Second' })
    await waitForAnswer(agentId, 'next')
    expect(bodies.at(-1)).toContain('gpt-6-sol')
    expect(bodies.at(-1)).toContain('You are the new prompt.')
  })
})

describe('convergence', () => {
  it('applies a version whose push was lost when the object next opens', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => modelResponse())
    const agentId = await newAgentId()
    await exports.default.snapshot(agentId)
    vi.spyOn(Agent.prototype, 'applyConfig').mockRejectedValueOnce(new Error('push lost'))
    const written = await updateSettings(agentId, { systemPrompt: 'Pulled on open' })
    expect(written.apply.state).toBe('failed')
    expect(await admin().getAgent(await owner(), agentId)).toMatchObject({
      desiredVersion: 1,
      appliedVersion: 0,
      pending: true,
    })

    await evictDurableObject(env.AGENTS.getByName(agentId))
    expect((await env.AGENTS.getByName(agentId).getConfig()).systemPrompt).toBe('Pulled on open')
    expect(await versions(agentId)).toEqual({ desired: 1, applied: 1 })
  })

  it('applies a version whose push was lost at the daily reconciliation', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => modelResponse())
    const agentId = await newAgentId()
    await exports.default.snapshot(agentId)
    vi.spyOn(Agent.prototype, 'applyConfig').mockRejectedValueOnce(new Error('push lost'))
    await updateSettings(agentId, { systemPrompt: 'Pushed again' })
    expect(await versions(agentId)).toEqual({ desired: 1, applied: 0 })

    await reconcile()
    expect(await versions(agentId)).toEqual({ desired: 1, applied: 1 })
    expect((await env.AGENTS.getByName(agentId).getConfig()).systemPrompt).toBe('Pushed again')
  })

  it('keeps the previous applied version when one part fails, and retries the version', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => modelResponse())
    const agentId = await newAgentId()
    using before = await env.AGENTS.getByName(agentId).getConfig()
    // The memory rebuild reads D1; make it fail.
    const prepare = vi.spyOn(env.MEMORY_DB, 'prepare').mockImplementation(() => {
      throw new Error('D1 unavailable')
    })
    const written = await updateSettings(agentId, {
      systemPrompt: 'Needs memory',
      sharedSpaces: ['team-x', 'global'],
    })
    expect(written.apply).toEqual({ state: 'failed', appliedVersion: 0 })
    expect(await versions(agentId)).toEqual({ desired: 1, applied: 0 })
    expect(await env.AGENTS.getByName(agentId).getConfig()).toEqual(before)

    prepare.mockRestore()
    await reconcile()
    expect(await versions(agentId)).toEqual({ desired: 1, applied: 1 })
    expect(await env.AGENTS.getByName(agentId).getConfig()).toMatchObject({
      systemPrompt: 'Needs memory',
      sharedSpaces: ['team-x', 'global'],
    })
  })
})

describe('restrictions', () => {
  it('stop the next external call in the running turn, without waiting for idle', async () => {
    const agentId = await newAgentId()
    await updateSettings(agentId, { tools: ['current_time'] })
    const execute = vi.spyOn(currentTimeTool, 'execute')
    // A fresh stub per call: the continuation after `started` may run in another object's context.
    const stub = () => env.AGENTS.getByName(agentId)
    const started = Promise.withResolvers<void>()
    const response = Promise.withResolvers<Response>()
    let requests = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      requests++
      if (requests > 1) return textResponse('Should not be reached')
      started.resolve()
      return response.promise
    })
    await exports.default.sendMessage(agentId, { requestId: 'restricted', content: 'Time?' })
    // Restricted while the first model request is in flight: the turn is still running.
    await started.promise
    await stub().setStatus('paused')
    response.resolve(toolCallResponse({ name: 'current_time', arguments: {} }))
    const submission = await settled(agentId, 'restricted')
    expect(submission).toMatchObject({ status: 'unanswered', reason: 'model_error' })
    expect(submission?.status === 'unanswered' ? submission.detail : '').toMatch(/agent_restricted/)
    // The tool call was blocked and the next model request never left the object.
    expect(requests).toBe(1)
    expect(execute).not.toHaveBeenCalled()

    const other = await newAgentId()
    const sent = Promise.resolve(stub().sendTo(other, { requestId: 'm', content: 'Hello' })).then(
      () => 'sent',
      (error: unknown) => String(error),
    )
    expect(await sent).toMatch(/agent_restricted/)

    await stub().setStatus('active')
    vi.mocked(globalThis.fetch).mockImplementation(async () => modelResponse())
    await exports.default.sendMessage(agentId, { requestId: 'again', content: 'Hello' })
    await waitForAnswer(agentId, 'again')
  })
})
