/** Seed initialization validates both models before creating agents; identity is independent. @module */
import { credentialCall, testCredentialRefs } from '../../helper/credentials.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import { runInDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  agentMembers,
  agentConfigVersions,
  agentCredentialRefs,
  credentialGrants,
  auditLog,
  agents,
  principals,
  systemSettings,
} from '../../../drizzle/management/schema.ts'
import { agentService, management } from '../../helper/management.ts'
import { activeContents, memoryAgent } from '../../helper/memory.ts'
import { requestBody, textResponse, toolCallResponse, toolResults } from '../../helper/model.ts'
import { piEntries } from '../../storage/pi-tables.ts'
import { drizzle } from 'drizzle-orm/durable-sqlite'
import { useMockModel, waitForAnswer } from '../../helper/rpc.ts'
import { seed, FIRST_AGENT_PROMPT, FIRST_AGENT_SLUG, MEMORY_AGENT_ID } from './seed.ts'
// Load the provider outside short-lived DO requests.
import '@earendil-works/pi-ai/api/openai-responses'

useMockModel()
afterEach(() => vi.restoreAllMocks())

const actor = { kind: 'user', externalId: 'seed-tester@example.com' } as const

async function firstAgent() {
  const row = await management.select().from(agents).where(eq(agents.slug, FIRST_AGENT_SLUG)).get()
  if (row === undefined) throw new Error('The seed created no first agent')
  return row
}

describe('seed', () => {
  it.each(['openai', 'xai', 'all'])(
    'rejects missing %s references without creating agents or changing identity',
    async (missing) => {
      // The memory-test helper seeds in beforeAll; exercise a genuinely fresh installation.
      for (const table of [
        auditLog,
        agentMembers,
        agentCredentialRefs,
        credentialGrants,
        agentConfigVersions,
        agents,
        systemSettings,
      ])
        await management.delete(table)
      const refs = await testCredentialRefs()
      if (missing === 'all') refs.primary = {}
      else delete refs.primary[missing]
      const call = await credentialCall()
      const identity = await management.select().from(systemSettings)
      await expect(
        seed(
          {
            ...call,
            principal: null,
            env: { ...env, MEMORY_MODEL_PROVIDER: 'xai', MEMORY_MODEL_ID: 'grok-4.3' },
          },
          refs,
        ),
      ).rejects.toThrow('credential_unavailable')
      expect(await management.select().from(agents)).toEqual([])
      expect(await management.select().from(systemSettings)).toEqual(identity)
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

    const memory = await management
      .select()
      .from(agents)
      .where(eq(agents.agentId, MEMORY_AGENT_ID))
      .get()
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
      ownerId: null,
    })
    expect(first.objectName).toBe(first.agentId)
    // Like any other agent: no principal, membership, or setting of its own.
    expect(
      await management.select().from(principals).where(eq(principals.externalId, first.agentId)),
    ).toEqual([])
    expect(
      await management.select().from(agentMembers).where(eq(agentMembers.agentId, first.agentId)),
    ).toEqual([])
    const settings = await management.select().from(systemSettings)
    expect(Object.fromEntries(settings.map((row) => [row.key, JSON.parse(row.valueJson)]))).toEqual(
      { install_id: seeded.installId },
    )
    expect(
      (await management.select().from(agents).where(eq(agents.slug, FIRST_AGENT_SLUG))).length,
    ).toBe(1)

    const { settings: v1 } = await agentService().getConfig(actor, first.agentId)
    expect(v1.systemPrompt).toBe(FIRST_AGENT_PROMPT)
    await exports.default.sendMessage(first.agentId, { requestId: 'hi', content: 'Hello' })
    await waitForAnswer(first.agentId, 'hi')
  })

  it('keeps later changes to the first agent when it runs again', async () => {
    await agentService().seed()
    const { agentId } = await firstAgent()
    const { settings } = await agentService().getConfig(actor, agentId)
    const desired = (await agentService().getAgent(actor, agentId)).desiredVersion
    await agentService().updateConfig(actor, agentId, {
      requestId: uuidv7(),
      settings: { ...settings, systemPrompt: 'Changed later' },
      expectedVersion: desired,
    })
    await agentService().renameAgent(actor, agentId, { displayName: 'Renamed' })
    await agentService().seed()
    const after = await agentService().getAgent(actor, agentId)
    expect(after).toMatchObject({ displayName: 'Renamed', desiredVersion: desired + 1 })
    expect((await agentService().getConfig(actor, agentId)).settings.systemPrompt).toBe(
      'Changed later',
    )
  })

  it('lets the memory agent take its model from its versions', async () => {
    await agentService().seed()
    const current = await agentService().getConfig(actor, MEMORY_AGENT_ID)
    const result = await agentService().updateConfig(actor, MEMORY_AGENT_ID, {
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
    const current = await agentService().getConfig(actor, MEMORY_AGENT_ID)
    const result = await agentService().updateConfig(actor, MEMORY_AGENT_ID, {
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
      origin: 'user_request',
      content: fact,
      sourceEntries: { from: 1, to: 1 },
    })
    await expect
      .poll(async () => (await memoryAgent().jobStatus(job.jobId))?.status, { timeout: 10_000 })
      .toBe('settled')
    expect(await activeContents(sourceAgentId)).toEqual([])
    const blocked = await runInDurableObject(memoryAgent(), (_instance, state) =>
      drizzle(state.storage).select({ record: piEntries.record }).from(piEntries).all(),
    )
    expect(JSON.stringify(blocked)).toContain("denied by the agent's tool policy")
  })
})
