import { runInDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { agents, principals, systemSettings } from '../../drizzle/control/schema.ts'
import { admin, control } from '../helper/control.ts'
import { memoryAgent } from '../helper/memory.ts'
import { useMockModel, waitForAnswer } from '../helper/rpc.ts'
import { ADMIN_AGENT_PROMPT, MEMORY_AGENT_ID } from './seed.ts'
// Load the provider outside short-lived DO requests.
import '@earendil-works/pi-ai/api/openai-responses'

useMockModel()

describe('seed', () => {
  it('registers the memory agent on its existing object, and the administrator agent as the owner', async () => {
    // State the memory agent's object holds from before the registry existed.
    await runInDurableObject(memoryAgent(), async (_instance, state) => {
      await state.storage.put('test:marker', 'kept')
    })

    const first = await admin().seed()
    const again = await admin().seed()
    expect(again).toEqual(first)
    expect(first.memoryAgentId).toBe(MEMORY_AGENT_ID)

    const memory = await control
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

    const adminRow = await control
      .select()
      .from(agents)
      .where(eq(agents.agentId, first.adminAgentId))
      .get()
    expect(adminRow).toMatchObject({
      kind: 'working',
      objectName: first.adminAgentId,
      slug: 'assistant',
      status: 'active',
      currentVersion: 1,
      appliedVersion: 1,
      ownerId: first.adminAgentId,
    })
    expect(
      await control
        .select()
        .from(principals)
        .where(eq(principals.principalId, first.adminAgentId))
        .get(),
    ).toMatchObject({ kind: 'agent', externalId: first.adminAgentId, systemRole: 'owner' })
    const settings = await control.select().from(systemSettings)
    expect(Object.fromEntries(settings.map((row) => [row.key, JSON.parse(row.valueJson)]))).toEqual(
      {
        install_id: first.installId,
        admin_agent_id: first.adminAgentId,
      },
    )

    const actor = { kind: 'agent', externalId: first.adminAgentId } as const
    const { settings: v1 } = await admin().getConfig(actor, first.adminAgentId)
    expect(v1.systemPrompt).toBe(ADMIN_AGENT_PROMPT)
    await exports.default.sendMessage(first.adminAgentId, { requestId: 'hi', content: 'Hello' })
    await waitForAnswer(first.adminAgentId, 'hi')
  })

  it('keeps later changes to the administrator agent when it runs again', async () => {
    const { adminAgentId } = await admin().seed()
    const actor = { kind: 'agent', externalId: adminAgentId } as const
    const { settings } = await admin().getConfig(actor, adminAgentId)
    const desired = (await admin().getAgent(actor, adminAgentId)).desiredVersion
    await admin().updateConfig(actor, adminAgentId, {
      requestId: crypto.randomUUID(),
      settings: { ...settings, systemPrompt: 'Changed by the owner' },
      expectedVersion: desired,
    })
    await admin().renameAgent(actor, adminAgentId, { displayName: 'Renamed' })
    await admin().seed()
    const after = await admin().getAgent(actor, adminAgentId)
    expect(after).toMatchObject({ displayName: 'Renamed', desiredVersion: desired + 1 })
    expect((await admin().getConfig(actor, adminAgentId)).settings.systemPrompt).toBe(
      'Changed by the owner',
    )
  })

  it('lets the memory agent take its model from its versions', async () => {
    const { adminAgentId } = await admin().seed()
    const actor = { kind: 'agent', externalId: adminAgentId } as const
    const current = await admin().getConfig(actor, MEMORY_AGENT_ID)
    const result = await admin().updateConfig(actor, MEMORY_AGENT_ID, {
      requestId: crypto.randomUUID(),
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
})
