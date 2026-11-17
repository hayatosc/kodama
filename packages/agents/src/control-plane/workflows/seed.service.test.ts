/** Seed initialization validates both models before creating agents; identity is independent. @module */
import { runInDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test'
import { runBatch } from '../../lib/reylo.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import { MEMORY_AGENT_ID } from '../../memory/jobs.ts'
import { credentialCall, testCredentialRefs } from '../../testing/credentials.ts'
import { agentService, management, seedOnce } from '../../testing/management.ts'
import { activeContents, memoryAgent } from '../../testing/memory.ts'
import { requestBody, textResponse, toolCallResponse, toolResults } from '../../testing/model.ts'
import { useMockModel, waitForAnswer } from '../../testing/rpc.ts'
import {
  listAllAgents,
  listAllSystemSettings,
  listPiEntryRecords,
} from '../../testing/test-db.repository.ts'
import { findAgentById, findAgentBySlug } from '../registry.repository.ts'
import { FIRST_AGENT_PROMPT, FIRST_AGENT_SLUG, seed } from './seed.service.ts'

// The memory agent needs the seeded installation and its credentials.
beforeAll(seedOnce)
// Load the provider outside short-lived DO requests.
import '@earendil-works/pi-ai/api/openai-responses'

useMockModel()
afterEach(() => vi.restoreAllMocks())

async function firstAgent() {
  const row = await findAgentBySlug(management, FIRST_AGENT_SLUG)
  if (row === undefined) throw new Error('The seed created no first agent')
  return row
}

describe('seed', () => {
  it.each(['openai', 'xai', 'all'])(
    'rejects missing %s references without creating agents or changing identity',
    async (missing) => {
      // The memory-test helper seeds in beforeAll; exercise a genuinely fresh installation.
      const tables = [
        'audit_log',
        'agent_credential_refs',
        'credential_grants',
        'agent_config_versions',
        'agents',
        'system_settings',
      ]
      await runBatch(
        management,
        tables.map((table) => management.prepare(`DELETE FROM ${table}`)),
      )
      const refs = await testCredentialRefs()
      if (missing === 'all') refs.primary = {}
      else delete refs.primary[missing]
      const call = credentialCall()
      const identity = await listAllSystemSettings(management)
      await expect(
        seed(
          {
            ...call,
            env: { ...env, MEMORY_MODEL_PROVIDER: 'xai', MEMORY_MODEL_ID: 'grok-4.3' },
          },
          refs,
        ),
      ).rejects.toThrow('credential_unavailable')
      expect(await listAllAgents(management)).toEqual([])
      expect(await listAllSystemSettings(management)).toEqual(identity)
      await exports.default.seed(await testCredentialRefs())
    },
  )

  it('registers the memory agent on its existing object, and the first agent like any other', async () => {
    // State the memory agent's object holds from before the registry existed.
    await runInDurableObject(memoryAgent(), async (_instance, state) => {
      await state.storage.put('test:marker', 'kept')
    })

    const seeded = await agentService().seed()
    const again = await agentService().seed()
    expect(again).toEqual(seeded)
    expect(seeded.memoryAgentId).toBe(MEMORY_AGENT_ID)

    const memory = await findAgentById(management, MEMORY_AGENT_ID)
    expect(memory).toMatchObject({
      kind: 'dedicated',
      objectName: 'kodama:memory',
      status: 'active',
      currentVersion: 1,
      appliedVersion: 1,
    })
    const marker = await runInDurableObject(memoryAgent(), (_instance, state) =>
      state.storage.get('test:marker'),
    )
    expect(marker).toBe('kept')

    const first = await firstAgent()
    expect(first).toMatchObject({
      kind: 'working',
      slug: FIRST_AGENT_SLUG,
      status: 'active',
      currentVersion: 1,
      appliedVersion: 1,
    })
    expect(first.objectName).toBe(first.agentId)
    expect(first).not.toHaveProperty('ownerId')
    const settings = await listAllSystemSettings(management)
    expect(Object.fromEntries(settings.map((row) => [row.key, JSON.parse(row.valueJson)]))).toEqual(
      { install_id: seeded.installId },
    )
    expect(
      (await listAllAgents(management)).filter((row) => row.slug === FIRST_AGENT_SLUG).length,
    ).toBe(1)

    const { settings: v1 } = await agentService().getConfig(first.agentId)
    expect(v1.systemPrompt).toBe(FIRST_AGENT_PROMPT)
    await exports.default.sendMessage(first.agentId, { requestId: 'hi', content: 'Hello' })
    await waitForAnswer(first.agentId, 'hi')
  })

  it('keeps later changes to the first agent when it runs again', async () => {
    await agentService().seed()
    const { agentId } = await firstAgent()
    const { settings } = await agentService().getConfig(agentId)
    const desired = (await agentService().getAgent(agentId)).desiredVersion
    await agentService().updateConfig(agentId, {
      requestId: uuidv7(),
      settings: { ...settings, systemPrompt: 'Changed later' },
      expectedVersion: desired,
    })
    await agentService().renameAgent(agentId, { displayName: 'Renamed' })
    await agentService().seed()
    const after = await agentService().getAgent(agentId)
    expect(after).toMatchObject({ displayName: 'Renamed', desiredVersion: desired + 1 })
    expect((await agentService().getConfig(agentId)).settings.systemPrompt).toBe('Changed later')
  })

  it('lets the memory agent take its model from its versions', async () => {
    await agentService().seed()
    const current = await agentService().getConfig(MEMORY_AGENT_ID)
    const result = await agentService().updateConfig(MEMORY_AGENT_ID, {
      requestId: uuidv7(),
      settings: { ...current.settings, model: { provider: 'xai', modelId: 'grok-4.3' } },
      expectedVersion: current.version,
    })
    expect(result.apply.appliedVersion).toBe(current.version + 1)
    expect((await memoryAgent().getConfig()).model).toEqual({
      provider: 'xai',
      modelId: 'grok-4.3',
    })
    expect(env.MEMORY_MODEL_PROVIDER).toBe('')
  })

  it("applies the memory agent's tool policy: a denied tool is blocked in its jobs", async () => {
    await agentService().seed()
    const current = await agentService().getConfig(MEMORY_AGENT_ID)
    const result = await agentService().updateConfig(MEMORY_AGENT_ID, {
      requestId: uuidv7(),
      settings: { ...current.settings, toolPolicy: { memory_write: 'deny' } },
      expectedVersion: current.version,
    })
    expect(result.apply.appliedVersion).toBe(current.version + 1)

    const sourceAgentId = uuidv7()
    const fact = `Denied fact ${sourceAgentId.slice(0, 8)}`
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) =>
      toolResults(requestBody(init)) === 0
        ? toolCallResponse({ name: 'memory_write', arguments: { kind: 'fact', content: fact } })
        : textResponse('Could not write.'),
    )
    const job = await memoryAgent().enqueue({
      kind: 'remember',
      sourceAgentId,
      content: fact,
      sourceEntries: { from: 1, to: 1 },
    })
    await expect
      .poll(async () => (await memoryAgent().jobStatus(job.jobId))?.status, { timeout: 10_000 })
      .toBe('settled')
    expect(await activeContents(sourceAgentId)).toEqual([])
    const blocked = await runInDurableObject(memoryAgent(), (_instance, state) =>
      listPiEntryRecords(state.storage.sql),
    )
    expect(JSON.stringify(blocked)).toContain("denied by the agent's tool policy")
  })
})
