import { env, exports } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  agentConfigVersions,
  agentMembers,
  agents,
  auditLog,
} from '../../../drizzle/management/schema.ts'
import {
  managementService,
  caller,
  management,
  principalIdOf,
  newAgentId,
  seedOnce,
} from '../../helper/management.ts'
import { useMockModel, waitForAnswer } from '../../helper/rpc.ts'
import { write, db } from '../../helper/memory.ts'
import { agentScope } from '../../memory/store/db.ts'
import { memoryRecords } from '../../../drizzle/memory/schema.ts'
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
  return managementService().createAgent(await caller(), {
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
    const first = await managementService().createAgent(actor, request)
    const again = await managementService().createAgent(actor, request)
    expect(again.agentId).toBe(first.agentId)
    const taken = managementService().createAgent(actor, {
      ...request,
      requestId: crypto.randomUUID(),
    })
    expect(await rejection(taken)).toMatch(/slug is taken/)
  })

  it('creates one agent for two concurrent deliveries of the same request', async () => {
    const actor = await caller()
    const request = { requestId: crypto.randomUUID(), displayName: 'Twice', slug: uniqueSlug() }

    const [first, second] = await Promise.all([
      managementService().createAgent(actor, request),
      managementService().createAgent(actor, request),
    ])

    expect(second.agentId).toBe(first.agentId)
    const rows = await management.select().from(agents).where(eq(agents.slug, request.slug))
    expect(rows).toHaveLength(1)
  })

  it('never accepts an ID from the caller', async () => {
    const actor = await caller()
    const request = {
      requestId: crypto.randomUUID(),
      displayName: 'Chosen',
      agentId: crypto.randomUUID(),
    }
    const withId = managementService().createAgent(actor, request)
    expect(await rejection(withId)).toMatch(/requestId and displayName/)
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

    const renamed = await managementService().renameAgent(actor, agentId, {
      displayName: 'After',
      slug,
    })
    expect(renamed).toMatchObject({ agentId, displayName: 'After', slug, desiredVersion: 1 })
    expect((await managementService().resolveAgent(actor, slug)).agentId).toBe(agentId)
    const history = (await exports.default.snapshot(agentId)).snapshot.messages
    expect(history.filter((message) => message.role === 'user')).toHaveLength(1)
    const memory = await db
      .select()
      .from(memoryRecords)
      .where(eq(memoryRecords.scope, agentScope(agentId)))
    expect(memory.map((row) => row.content)).toEqual(['Likes tea'])
    const cleared = await managementService().renameAgent(actor, agentId, { slug: null })
    expect(cleared.slug).toBeUndefined()
  })

  it('refuses a slug another agent has and keeps the old one', async () => {
    const actor = await caller()
    const taken = uniqueSlug()
    await create('Holder', taken)
    const slug = uniqueSlug()
    const { agentId } = await create('Mover', slug)

    const refused = managementService().renameAgent(actor, agentId, { slug: taken })

    expect(await rejection(refused)).toMatch(`slug is taken: ${taken}`)
    expect((await managementService().getAgent(actor, agentId)).slug).toBe(slug)
  })
})

describe('listAgents and resolveAgent', () => {
  it('lists registry rows with desired and applied versions, and the memory agent as dedicated', async () => {
    const actor = await caller()
    const created = await create()
    const listed = await managementService().listAgents(actor)
    expect(listed.find((row) => row.agentId === created.agentId)).toMatchObject({
      desiredVersion: 1,
      appliedVersion: 1,
      pending: false,
    })
    expect(listed.find((row) => row.agentId === MEMORY_AGENT_ID)).toMatchObject({
      kind: 'dedicated',
      desiredVersion: 1,
    })
    const dedicated = await managementService().listAgents(actor, { kind: 'dedicated' })
    expect(dedicated.map((row) => row.agentId)).toEqual([MEMORY_AGENT_ID])
    expect(
      (await managementService().resolveAgent(actor, created.agentId.slice(0, 30))).agentId,
    ).toBe(created.agentId)
  })
})

describe('configuration versions', () => {
  it('lets exactly one of two updates from the same version win, and leaves nothing of the other', async () => {
    const actor = await caller()
    const { agentId } = await create()
    const { settings } = await managementService().getConfig(actor, agentId)
    const update = (systemPrompt: string) =>
      Promise.resolve(
        managementService().updateConfig(actor, agentId, {
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
    const { settings } = await managementService().getConfig(actor, agentId)
    const request = {
      requestId: crypto.randomUUID(),
      settings: { ...settings, systemPrompt: 'Once' },
      expectedVersion: 1,
    }
    expect((await managementService().updateConfig(actor, agentId, request)).version).toBe(2)
    expect((await managementService().updateConfig(actor, agentId, request)).version).toBe(2)
    expect((await managementService().getAgent(actor, agentId)).desiredVersion).toBe(2)
  })

  it('answers two concurrent deliveries of one update with the same version', async () => {
    const actor = await caller()
    const { agentId } = await create()
    const { settings } = await managementService().getConfig(actor, agentId)
    const request = {
      requestId: crypto.randomUUID(),
      settings: { ...settings, systemPrompt: 'Concurrent' },
      expectedVersion: 1,
    }

    const results = await Promise.all([
      managementService().updateConfig(actor, agentId, request),
      managementService().updateConfig(actor, agentId, request),
    ])

    expect(results.map((result) => result.version)).toEqual([2, 2])
    expect((await managementService().getAgent(actor, agentId)).desiredVersion).toBe(2)
  })

  it('refuses to read the configuration of an agent with no version', async () => {
    const agentId = await newAgentId()

    const refused = managementService().getConfig(await caller(), agentId)

    expect(await rejection(refused)).toMatch(`Agent ${agentId} has no configuration version`)
  })

  it('rolls back by writing the old content as a new version, and lists who changed what and when', async () => {
    const actor = await caller()
    const { agentId } = await create()
    const authorId = await principalIdOf(actor)
    const v1 = await managementService().getConfig(actor, agentId)
    await managementService().updateConfig(actor, agentId, {
      requestId: crypto.randomUUID(),
      settings: { ...v1.settings, systemPrompt: 'Changed' },
      expectedVersion: 1,
      comment: 'try a new prompt',
    })
    const rolled = await managementService().rollbackConfig(actor, agentId, {
      requestId: crypto.randomUUID(),
      toVersion: 1,
      expectedVersion: 2,
    })
    expect(rolled.version).toBe(3)
    expect((await managementService().getConfig(actor, agentId)).settings).toEqual(v1.settings)
    expect((await env.AGENTS.getByName(agentId).getConfig()).systemPrompt).toBe(
      v1.settings.systemPrompt,
    )
    const history = await managementService().configHistory(actor, agentId)
    expect(
      history.map(({ version, authorId, comment }) => ({ version, authorId, comment })),
    ).toEqual([
      { version: 3, authorId, comment: 'rollback to version 1' },
      { version: 2, authorId, comment: 'try a new prompt' },
      { version: 1, authorId, comment: 'create' },
    ])
    for (const entry of history) expect(entry.createdAt).toBeGreaterThan(0)
    expect(
      (await managementService().configHistory(actor, agentId, { before: 3, limit: 1 })).map(
        (e) => e.version,
      ),
    ).toEqual([2])
  })
})

describe('the seed in this file', () => {
  it('is in place before the other tests act', async () => {
    expect((await seedOnce()).memoryAgentId).toBe(MEMORY_AGENT_ID)
  })
})
