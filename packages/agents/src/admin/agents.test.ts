import { env, exports } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  agentConfigVersions,
  agentMembers,
  agents,
  auditLog,
  principals,
} from '../../drizzle/management/schema.ts'
import { admin, caller, management, principalIdOf, seedOnce } from '../helper/management.ts'
import { useMockModel, waitForAnswer } from '../helper/rpc.ts'
import { write, db } from '../helper/memory.ts'
import { agentScope } from '../memory/store/db.ts'
import { memoryRecords } from '../../drizzle/memory/schema.ts'
import { MEMORY_AGENT_ID } from './seed.ts'
// Load the provider outside short-lived DO requests.
import '@earendil-works/pi-ai/api/openai-responses'

useMockModel()

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function rejection(promise: Promise<unknown>): Promise<string> {
  return Promise.resolve(promise).then(
    () => 'accepted',
    (error: unknown) => String(error),
  )
}

async function create(displayName = 'Researcher', slug?: string) {
  return admin().createAgent(await caller(), {
    requestId: crypto.randomUUID(),
    displayName,
    ...(slug === undefined ? {} : { slug }),
  })
}

const uniqueSlug = () => `agent-${crypto.randomUUID().slice(0, 8)}`

describe('createAgent', () => {
  it('assigns a UUID v7, writes the registry, version 1, membership, and audit, and activates it', async () => {
    const actor = await caller()
    const created = await create('Researcher', uniqueSlug())
    expect(created.agentId).toMatch(UUID_V7)
    expect(created).toMatchObject({
      kind: 'working',
      status: 'active',
      desiredVersion: 1,
      appliedVersion: 1,
      pending: false,
    })
    const versions = await management
      .select()
      .from(agentConfigVersions)
      .where(eq(agentConfigVersions.agentId, created.agentId))
    expect(versions.map((row) => row.version)).toEqual([1])
    const members = await management
      .select()
      .from(agentMembers)
      .where(eq(agentMembers.agentId, created.agentId))
    expect(members).toEqual([
      { agentId: created.agentId, principalId: await principalIdOf(actor), role: 'owner' },
    ])
    const audit = await management
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.targetId, created.agentId))
    expect(audit.map((row) => row.action)).toEqual(['agent.create', 'agent.activate'])

    await exports.default.sendMessage(created.agentId, { requestId: 'hi', content: 'Hello' })
    await waitForAnswer(created.agentId, 'hi')
  })

  it('returns the first agent for a repeated requestId, and refuses a taken slug', async () => {
    const actor = await caller()
    const request = { requestId: crypto.randomUUID(), displayName: 'Once', slug: uniqueSlug() }
    const first = await admin().createAgent(actor, request)
    const again = await admin().createAgent(actor, request)
    expect(again.agentId).toBe(first.agentId)
    const taken = admin().createAgent(actor, { ...request, requestId: crypto.randomUUID() })
    expect(await rejection(taken)).toMatch(/slug is taken/)
  })

  it('never accepts an ID from the caller', async () => {
    const actor = await caller()
    const withId = admin().createAgent(actor, {
      requestId: crypto.randomUUID(),
      displayName: 'Chosen',
      // @ts-expect-error The request has no agentId field.
      agentId: crypto.randomUUID(),
    })
    expect(await rejection(withId)).toMatch(/requestId and displayName/)
  })
})

describe('callers', () => {
  it('lets an agent create and configure agents as a person does, and records it as the actor', async () => {
    const { agentId: callerAgentId } = await create()
    const actor = { kind: 'agent', externalId: callerAgentId } as const
    const created = await admin().createAgent(actor, {
      requestId: crypto.randomUUID(),
      displayName: 'Made by an agent',
    })
    const { settings } = await admin().getConfig(actor, created.agentId)
    await admin().updateConfig(actor, created.agentId, {
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
    const history = await admin().configHistory(actor, created.agentId)
    expect(history.map((entry) => entry.authorId)).toEqual([principalId, principalId])
  })

  it('accepts a person, a service, and an agent alike, and refuses a disabled principal', async () => {
    const id = crypto.randomUUID()
    for (const kind of ['user', 'service', 'agent'] as const) {
      const actor = { kind, externalId: `${kind}-${id}` }
      expect(Array.isArray(await admin().listAgents(actor))).toBe(true)
    }
    const disabled = { kind: 'user', externalId: `user-${id}` } as const
    await management
      .update(principals)
      .set({ disabledAt: Date.now() })
      .where(eq(principals.externalId, disabled.externalId))
    expect(await rejection(admin().listAgents(disabled))).toMatch(/forbidden/)
  })
})

describe('renameAgent', () => {
  it('changes only the display name and slug: the UUID, object, memory, and history stay', async () => {
    const actor = await caller()
    const created = await create('Before', uniqueSlug())
    const { agentId } = created
    await exports.default.sendMessage(agentId, { requestId: 'before', content: 'Hello' })
    await waitForAnswer(agentId, 'before')
    await write({
      scope: agentScope(agentId),
      kind: 'fact',
      content: 'Likes tea',
      sourceAgentId: agentId,
    })
    const slug = uniqueSlug()

    const renamed = await admin().renameAgent(actor, agentId, { displayName: 'After', slug })
    expect(renamed).toMatchObject({ agentId, displayName: 'After', slug, desiredVersion: 1 })
    expect((await admin().resolveAgent(actor, slug)).agentId).toBe(agentId)
    const history = (await exports.default.snapshot(agentId)).snapshot.messages
    expect(history.filter((message) => message.role === 'user')).toHaveLength(1)
    const memory = await db
      .select()
      .from(memoryRecords)
      .where(eq(memoryRecords.scope, agentScope(agentId)))
    expect(memory.map((row) => row.content)).toEqual(['Likes tea'])
    const cleared = await admin().renameAgent(actor, agentId, { slug: null })
    expect(cleared.slug).toBeUndefined()
  })
})

describe('listAgents and resolveAgent', () => {
  it('lists registry rows with desired and applied versions, and the memory agent as dedicated', async () => {
    const actor = await caller()
    const created = await create()
    const listed = await admin().listAgents(actor)
    expect(listed.find((row) => row.agentId === created.agentId)).toMatchObject({
      desiredVersion: 1,
      appliedVersion: 1,
      pending: false,
    })
    expect(listed.find((row) => row.agentId === MEMORY_AGENT_ID)).toMatchObject({
      kind: 'dedicated',
      desiredVersion: 1,
    })
    const dedicated = await admin().listAgents(actor, { kind: 'dedicated' })
    expect(dedicated.map((row) => row.agentId)).toEqual([MEMORY_AGENT_ID])
    expect((await admin().resolveAgent(actor, created.agentId.slice(0, 30))).agentId).toBe(
      created.agentId,
    )
  })
})

describe('configuration versions', () => {
  it('lets exactly one of two updates from the same version win, and leaves nothing of the other', async () => {
    const actor = await caller()
    const { agentId } = await create()
    const { settings } = await admin().getConfig(actor, agentId)
    const update = (systemPrompt: string) =>
      Promise.resolve(
        admin().updateConfig(actor, agentId, {
          requestId: crypto.randomUUID(),
          settings: { ...settings, systemPrompt },
          expectedVersion: 1,
        }),
      ).then(
        (result) => ({ ok: true as const, version: result.version }),
        (error: unknown) => ({ ok: false as const, error: String(error) }),
      )
    const results = await Promise.all([update('First'), update('Second')])
    const won = results.filter((result) => result.ok)
    const lost = results.filter((result) => !result.ok)
    expect(won).toEqual([{ ok: true, version: 2 }])
    expect(lost).toHaveLength(1)
    expect(lost[0]).toMatchObject({ error: expect.stringMatching(/version_conflict/) })

    const versions = await management
      .select()
      .from(agentConfigVersions)
      .where(eq(agentConfigVersions.agentId, agentId))
    expect(versions.map((row) => row.version)).toEqual([1, 2])
    const configAudits = await management
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, agentId))
    expect(configAudits.filter((row) => row.action === 'agent.config')).toHaveLength(1)
    const row = await management.select().from(agents).where(eq(agents.agentId, agentId)).get()
    expect(row?.currentVersion).toBe(2)
  })

  it('treats a resent update as the first one', async () => {
    const actor = await caller()
    const { agentId } = await create()
    const { settings } = await admin().getConfig(actor, agentId)
    const request = {
      requestId: crypto.randomUUID(),
      settings: { ...settings, systemPrompt: 'Once' },
      expectedVersion: 1,
    }
    expect((await admin().updateConfig(actor, agentId, request)).version).toBe(2)
    expect((await admin().updateConfig(actor, agentId, request)).version).toBe(2)
    expect((await admin().getAgent(actor, agentId)).desiredVersion).toBe(2)
  })

  it('rolls back by writing the old content as a new version, and lists who changed what and when', async () => {
    const actor = await caller()
    const { agentId } = await create()
    const authorId = await principalIdOf(actor)
    const v1 = await admin().getConfig(actor, agentId)
    await admin().updateConfig(actor, agentId, {
      requestId: crypto.randomUUID(),
      settings: { ...v1.settings, systemPrompt: 'Changed' },
      expectedVersion: 1,
      comment: 'try a new prompt',
    })
    const rolled = await admin().rollbackConfig(actor, agentId, {
      requestId: crypto.randomUUID(),
      toVersion: 1,
      expectedVersion: 2,
    })
    expect(rolled.version).toBe(3)
    expect((await admin().getConfig(actor, agentId)).settings).toEqual(v1.settings)
    expect((await env.AGENTS.getByName(agentId).getConfig()).systemPrompt).toBe(
      v1.settings.systemPrompt,
    )
    const history = await admin().configHistory(actor, agentId)
    expect(
      history.map(({ version, authorId, comment }) => ({ version, authorId, comment })),
    ).toEqual([
      { version: 3, authorId, comment: 'rollback to version 1' },
      { version: 2, authorId, comment: 'try a new prompt' },
      { version: 1, authorId, comment: 'create' },
    ])
    for (const entry of history) expect(entry.createdAt).toBeGreaterThan(0)
    expect(
      (await admin().configHistory(actor, agentId, { before: 3, limit: 1 })).map((e) => e.version),
    ).toEqual([2])
  })
})

describe('the seed in this file', () => {
  it('is in place before the other tests act', async () => {
    expect((await seedOnce()).memoryAgentId).toBe(MEMORY_AGENT_ID)
  })
})
