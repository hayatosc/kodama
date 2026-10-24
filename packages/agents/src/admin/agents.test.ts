import { env, exports } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  agentConfigVersions,
  agentMembers,
  agents,
  auditLog,
} from '../../drizzle/control/schema.ts'
import { admin, control, owner, seedOnce } from '../helper/control.ts'
import { useMockModel, waitForAnswer } from '../helper/rpc.ts'
import { write, db } from '../helper/memory.ts'
import { agentScope } from '../memory/store/db.ts'
import { memoryRecords } from '../../drizzle/d1/schema.ts'
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
  return admin().createAgent(await owner(), {
    requestId: crypto.randomUUID(),
    displayName,
    ...(slug === undefined ? {} : { slug }),
  })
}

const uniqueSlug = () => `agent-${crypto.randomUUID().slice(0, 8)}`

describe('createAgent', () => {
  it('assigns a UUID v7, writes the registry, version 1, membership, and audit, and activates it', async () => {
    const actor = await owner()
    const created = await create('Researcher', uniqueSlug())
    expect(created.agentId).toMatch(UUID_V7)
    expect(created).toMatchObject({
      kind: 'working',
      status: 'active',
      desiredVersion: 1,
      appliedVersion: 1,
      pending: false,
    })
    const versions = await control
      .select()
      .from(agentConfigVersions)
      .where(eq(agentConfigVersions.agentId, created.agentId))
    expect(versions.map((row) => row.version)).toEqual([1])
    const members = await control
      .select()
      .from(agentMembers)
      .where(eq(agentMembers.agentId, created.agentId))
    expect(members).toEqual([
      { agentId: created.agentId, principalId: actor.externalId, role: 'owner' },
    ])
    const audit = await control
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.targetId, created.agentId))
    expect(audit.map((row) => row.action)).toEqual(['agent.create', 'agent.activate'])

    await exports.default.sendMessage(created.agentId, { requestId: 'hi', content: 'Hello' })
    await waitForAnswer(created.agentId, 'hi')
  })

  it('returns the first agent for a repeated requestId, and refuses a taken slug', async () => {
    const actor = await owner()
    const request = { requestId: crypto.randomUUID(), displayName: 'Once', slug: uniqueSlug() }
    const first = await admin().createAgent(actor, request)
    const again = await admin().createAgent(actor, request)
    expect(again.agentId).toBe(first.agentId)
    const taken = admin().createAgent(actor, { ...request, requestId: crypto.randomUUID() })
    expect(await rejection(taken)).toMatch(/slug is taken/)
  })

  it('never accepts an ID from the caller, and refuses callers that are not the owner', async () => {
    const actor = await owner()
    const withId = admin().createAgent(actor, {
      requestId: crypto.randomUUID(),
      displayName: 'Chosen',
      // @ts-expect-error The request has no agentId field.
      agentId: crypto.randomUUID(),
    })
    expect(await rejection(withId)).toMatch(/requestId and displayName/)
    const stranger = { kind: 'user', externalId: 'someone@example.com' } as const
    expect(await rejection(admin().listAgents(stranger))).toMatch(/forbidden/)
  })
})

describe('renameAgent', () => {
  it('changes only the display name and slug: the UUID, object, memory, and history stay', async () => {
    const actor = await owner()
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
    const actor = await owner()
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
    const actor = await owner()
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

    const versions = await control
      .select()
      .from(agentConfigVersions)
      .where(eq(agentConfigVersions.agentId, agentId))
    expect(versions.map((row) => row.version)).toEqual([1, 2])
    const configAudits = await control.select().from(auditLog).where(eq(auditLog.targetId, agentId))
    expect(configAudits.filter((row) => row.action === 'agent.config')).toHaveLength(1)
    const row = await control.select().from(agents).where(eq(agents.agentId, agentId)).get()
    expect(row?.currentVersion).toBe(2)
  })

  it('treats a resent update as the first one', async () => {
    const actor = await owner()
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
    const actor = await owner()
    const { agentId } = await create()
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
      { version: 3, authorId: actor.externalId, comment: 'rollback to version 1' },
      { version: 2, authorId: actor.externalId, comment: 'try a new prompt' },
      { version: 1, authorId: actor.externalId, comment: 'create' },
    ])
    for (const entry of history) expect(entry.createdAt).toBeGreaterThan(0)
    expect(
      (await admin().configHistory(actor, agentId, { before: 3, limit: 1 })).map((e) => e.version),
    ).toEqual([2])
  })
})

describe('the seed in this file', () => {
  it('is in place before the other tests act as the owner', async () => {
    expect((await seedOnce()).memoryAgentId).toBe(MEMORY_AGENT_ID)
  })
})
