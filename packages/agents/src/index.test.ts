/**
 * The service entrypoint refuses HTTP, and its daily cron pushes lost versions and queues the
 * memory agent's consolidation even when reconciliation fails.
 *
 * @module
 */
import { uuidv7 } from './lib/uuid.ts'
import { createExecutionContext, createScheduledController } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentConfigVersions, agents } from '../drizzle/management/schema.ts'
import { defaultAgentSettings } from './control-plane/config.ts'
import { management, newAgentId } from './testing/management.ts'
import { memoryAgent, write } from './testing/memory.ts'
import { textResponse, toolCallResponse, toolResults, requestBody } from './testing/model.ts'
import AgentService, * as entrypoint from './index.ts'
import { consolidationDay } from './memory/consolidation.ts'
import { jobId } from './memory/jobs.ts'
import type { MemoryJob } from './memory/jobs.ts'
// Load the provider outside short-lived DO requests.
import '@earendil-works/pi-ai/api/openai-responses'

afterEach(() => vi.restoreAllMocks())

/** Run the cron handler once at `now`. */
function runCron(now: number): Promise<void> {
  // The test Env types CLI_TOKEN as any string; the Worker declares it empty outside development.
  const service = new AgentService(createExecutionContext(), { ...env, CLI_TOKEN: '' })
  return service.scheduled(createScheduledController({ scheduledTime: now, cron: '0 3 * * *' }))
}

/** An agent whose version 1 is in the registry but never reached its object. */
async function agentWithLostVersion(systemPrompt: string): Promise<string> {
  const agentId = await newAgentId(undefined, false)
  await management.batch([
    management.insert(agentConfigVersions).values({
      agentId,
      version: 1,
      settingsJson: JSON.stringify({ ...defaultAgentSettings(env), systemPrompt }),
      schemaVersion: 1,
      createdAt: Date.now(),
    }),
    management.update(agents).set({ currentVersion: 1 }).where(eq(agents.agentId, agentId)),
  ])
  return agentId
}

describe('AgentService', () => {
  it('does not expose credential rotation or KEK maintenance RPCs', () => {
    const service = new AgentService(createExecutionContext(), { ...env, CLI_TOKEN: '' })
    expect('rotateCredential' in service).toBe(false)
    expect('rewrapCredentials' in service).toBe(false)
  })

  it('settles an awaited rejected RPC and remains callable', async () => {
    await expect(
      Promise.resolve(
        exports.default.sendMessage('', {
          requestId: '',
          content: 'Hello',
        }),
      ),
    ).rejects.toThrow()
    const response = await exports.default.fetch('https://kodama.test/')
    expect(response.status).toBe(404)
    await response.body?.cancel()
  })

  it('exports only the default RPC entrypoint and the Durable Object class', () => {
    expect(Object.keys(entrypoint).sort()).toEqual(['Agent', 'default'])
    for (const method of [
      'seed',
      'createAgent',
      'listAgents',
      'getAgent',
      'resolveAgent',
      'renameAgent',
      'getConfig',
      'updateConfig',
      'rollbackConfig',
      'configHistory',
      'sendMessage',
      'snapshot',
      'usage',
      'audit',
      'scheduled',
    ]) {
      expect(AgentService.prototype).toHaveProperty(method, expect.any(Function))
    }
  })

  it('answers HTTP with 404, since agents are reached only through RPC', async () => {
    const response = await exports.default.fetch('https://kodama.test/')

    expect(response.status).toBe(404)
  })

  it('pushes a lost version and queues consolidation of a changed scope on the daily cron', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) =>
      toolResults(requestBody(init)) === 0
        ? toolCallResponse({ name: 'memory_decline', arguments: { reason: 'Nothing to merge' } })
        : textResponse('Declined.'),
    )
    const agentId = await agentWithLostVersion('Pushed by the cron')
    const owner = uuidv7()
    await write({
      scope: `agent:${owner}`,
      kind: 'fact',
      content: 'Uses pnpm',
      sourceAgentId: owner,
    })
    const now = Date.now()

    await runCron(now)

    const row = await management.select().from(agents).where(eq(agents.agentId, agentId)).get()
    expect(row).toMatchObject({ currentVersion: 1, appliedVersion: 1 })
    expect((await env.AGENTS.getByName(agentId).getConfig()).systemPrompt).toBe(
      'Pushed by the cron',
    )
    const job: MemoryJob = {
      kind: 'consolidate',
      scope: `agent:${owner}`,
      day: consolidationDay(now),
    }
    expect(await memoryAgent().jobStatus(await jobId(job))).toMatchObject({ kind: 'consolidate' })
  })

  it('still queues consolidation when reconciliation fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => textResponse('Done.'))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(env.MANAGEMENT_DB, 'prepare').mockImplementation(() => {
      throw new Error('management database is down')
    })
    const owner = uuidv7()
    await write({
      scope: `agent:${owner}`,
      kind: 'fact',
      content: 'Uses pnpm',
      sourceAgentId: owner,
    })
    const now = Date.now()

    await runCron(now)

    expect(errors).toHaveBeenCalledWith('Configuration reconciliation failed', 'Error')
    const job: MemoryJob = {
      kind: 'consolidate',
      scope: `agent:${owner}`,
      day: consolidationDay(now),
    }
    expect(await memoryAgent().jobStatus(await jobId(job))).toMatchObject({ kind: 'consolidate' })
  })
})
