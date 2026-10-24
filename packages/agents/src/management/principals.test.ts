/**
 * Every kind of caller is a principal that may manage agents and is recorded as the actor, unless
 * it is disabled.
 *
 * @module
 */
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { auditLog, principals } from '../../drizzle/management/schema.ts'
import { caller, management, agentService, principalIdOf } from '../helper/management.ts'
import { useMockModel } from '../helper/rpc.ts'
// Load the provider outside short-lived DO requests.
import '@earendil-works/pi-ai/api/openai-responses'

useMockModel()

function rejection(promise: Promise<unknown>): Promise<string> {
  return Promise.resolve(promise).then(
    () => 'accepted',
    (error: unknown) => String(error),
  )
}

async function create() {
  return agentService().createAgent(await caller(), {
    requestId: crypto.randomUUID(),
    displayName: 'Caller',
  })
}

describe('callers', () => {
  it('lets an agent create and configure agents as a person does, and records it as the actor', async () => {
    const { agentId: callerAgentId } = await create()
    const actor = { kind: 'agent', externalId: callerAgentId } as const
    const created = await agentService().createAgent(actor, {
      requestId: crypto.randomUUID(),
      displayName: 'Made by an agent',
    })
    const { settings } = await agentService().getConfig(actor, created.agentId)
    await agentService().updateConfig(actor, created.agentId, {
      requestId: crypto.randomUUID(),
      settings: { ...settings, systemPrompt: 'Set by an agent' },
      expectedVersion: 1,
    })

    const principalId = await principalIdOf(actor)
    const row = await management
      .select()
      .from(principals)
      .where(eq(principals.principalId, principalId))
      .get()
    expect(row).toMatchObject({ kind: 'agent', externalId: callerAgentId, systemRole: null })
    const audit = await management
      .select({ action: auditLog.action, actorId: auditLog.actorId })
      .from(auditLog)
      .where(eq(auditLog.targetId, created.agentId))
    expect(audit).toEqual([
      { action: 'agent.create', actorId: principalId },
      { action: 'agent.activate', actorId: principalId },
      { action: 'agent.config', actorId: principalId },
    ])
    const history = await agentService().configHistory(actor, created.agentId)
    expect(history.map((entry) => entry.authorId)).toEqual([principalId, principalId])
  })

  it('accepts a person, a service, and an agent alike, and refuses a disabled principal', async () => {
    const id = crypto.randomUUID()
    for (const kind of ['user', 'service', 'agent'] as const) {
      const actor = { kind, externalId: `${kind}-${id}` }
      expect(Array.isArray(await agentService().listAgents(actor))).toBe(true)
    }
    const disabled = { kind: 'user', externalId: `user-${id}` } as const
    await management
      .update(principals)
      .set({ disabledAt: Date.now() })
      .where(eq(principals.externalId, disabled.externalId))
    expect(await rejection(agentService().listAgents(disabled))).toMatch(/forbidden/)
  })
})
