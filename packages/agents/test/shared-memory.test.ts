import { evictDurableObject, runInDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { invalidateOverridesOfRequired } from '../src/memory/consolidation.ts'
import { propose, skillFilesAsBlobs } from '../src/memory/proposals.ts'
import { applyOperation, memoryDb } from '../src/memory/records.ts'
import type { NewRecord, OperationContext, Scope } from '../src/memory/records.ts'
import { memoryLedger, memoryRecords, sharedProposals, skills } from '../src/memory/schema.ts'
import { writeSkill } from '../src/memory/skills.ts'
import { AlwaysLoadedMemory, MEMORY_AGENT_NAME } from '../src/memory/working.ts'
import { openLocalDb } from '../src/storage/local.ts'
import { requestBody, textResponse, toolCallResponse, toolResults } from './model.ts'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'

const db = memoryDb(env.MEMORY_DB)

afterEach(() => vi.restoreAllMocks())

function context(now = Date.now()): OperationContext {
  const opId = crypto.randomUUID()
  return { opId, jobId: opId, runId: opId, actor: 'test', now }
}

async function write(record: Omit<NewRecord, 'origin' | 'observedAt'>): Promise<string> {
  const result = await applyOperation(db, context(), {
    type: 'write',
    record: { origin: 'agent_judgment', observedAt: Date.now(), ...record },
  })
  if (result.status !== 'applied') throw new Error(`write ${result.status}`)
  return result.recordId
}

async function alwaysLoaded(agentId: string, spaces: string[]): Promise<string> {
  return runInDurableObject(env.AGENTS.getByName(agentId), async (_instance, state) => {
    const local = await openLocalDb(state.storage)
    const memory = new AlwaysLoadedMemory({
      env,
      agentId: () => agentId,
      local: () => Promise.resolve(local),
      sharedSpaces: () => Promise.resolve(spaces),
    })
    await memory.refresh()
    return memory.text()
  })
}

async function record(id: string) {
  return db.select().from(memoryRecords).where(eq(memoryRecords.id, id)).get()
}

async function waitForProposal(id: string, status: string) {
  await expect
    .poll(
      async () =>
        (await db.select().from(sharedProposals).where(eq(sharedProposals.id, id)).get())?.status,
      { timeout: 10_000 },
    )
    .toBe(status)
}

describe('shared spaces', () => {
  it('stores the spaces an agent reads next to its configuration', async () => {
    const agentId = crypto.randomUUID()
    using original = await exports.default.getConfig(agentId)
    expect(original.sharedSpaces).toEqual(['global'])

    await exports.default.setConfig(agentId, { ...original, sharedSpaces: ['team-a', 'global'] })
    await evictDurableObject(env.AGENTS.getByName(agentId))

    using stored = await exports.default.getConfig(agentId)
    expect(stored.sharedSpaces).toEqual(['team-a', 'global'])
    const invalid = await Promise.resolve(
      exports.default.setConfig(agentId, { ...original, sharedSpaces: ['Team A'] }),
    ).then(
      () => 'accepted',
      (error: unknown) => String(error),
    )
    expect(invalid).toMatch(/sharedSpaces/)
  })
})

describe('overrides', () => {
  it('lets an agent record replace a shared record for that agent, unless the shared one is required', async () => {
    const space = `space-${crypto.randomUUID().slice(0, 8)}`
    const scope: Scope = `shared:${space}`
    const agentId = crypto.randomUUID()
    const other = crypto.randomUUID()
    const shared = await write({
      scope,
      kind: 'instruction',
      content: 'Reply in English',
      sourceAgentId: 'memory',
    })
    const rule = await write({
      scope,
      kind: 'instruction',
      content: 'Never push to main',
      sourceAgentId: 'memory',
      required: true,
    })
    await write({
      scope: `agent:${agentId}`,
      kind: 'instruction',
      content: 'Reply in Japanese',
      sourceAgentId: agentId,
      overrides: shared,
    })
    const breaking = await write({
      scope: `agent:${agentId}`,
      kind: 'instruction',
      content: 'Pushing to main is fine',
      sourceAgentId: agentId,
      overrides: rule,
    })

    const mine = await alwaysLoaded(agentId, [space])
    const theirs = await alwaysLoaded(other, [space])

    expect(mine).toContain('Reply in Japanese')
    expect(mine).not.toContain('Reply in English')
    expect(mine).toContain('Never push to main')
    expect(mine).not.toContain('Pushing to main is fine')
    expect(theirs).toContain('Reply in English')

    await invalidateOverridesOfRequired(db, 'test-run', Date.now())
    expect((await record(breaking))?.status).toBe('invalid')
  })
})

describe('proposals', () => {
  it('applies an accepted record proposal once, after review through AgentService', async () => {
    const space = `space-${crypto.randomUUID().slice(0, 8)}`
    const source = await write({
      scope: `agent:${crypto.randomUUID()}`,
      kind: 'fact',
      content: 'The staging cluster is in Osaka',
      sourceAgentId: 'someone',
    })
    const proposal = await propose(db, context(), {
      space,
      payload: { type: 'record', kind: 'fact', content: 'The staging cluster is in Osaka' },
      sourceIds: [source],
    })

    const pending = await exports.default.listProposals(space)
    expect(pending.map((summary) => summary.id)).toEqual([proposal.id])

    const decided = await exports.default.decideProposal(proposal.id, {
      decision: 'accept',
      reason: 'Confirmed by ops',
      decidedBy: 'reviewer@example.com',
    })
    expect(decided.status).toBe('accepted')
    await waitForProposal(proposal.id, 'applied')

    const again = await exports.default.decideProposal(proposal.id, {
      decision: 'reject',
      reason: 'Changed my mind',
      decidedBy: 'reviewer@example.com',
    })
    expect(again.status).toBe('applied')
    const applied = await db
      .select()
      .from(memoryRecords)
      .where(and(eq(memoryRecords.scope, `shared:${space}`), eq(memoryRecords.status, 'active')))
    expect(applied.map((row) => [row.content, row.origin])).toEqual([
      ['The staging cluster is in Osaka', 'proposal'],
    ])
    expect(await alwaysLoaded(crypto.randomUUID(), [space])).toContain(
      'The staging cluster is in Osaka',
    )
  })

  it('turns a proposal into a conflict when its target changed after it was written', async () => {
    const space = `space-${crypto.randomUUID().slice(0, 8)}`
    const target = await write({
      scope: `shared:${space}`,
      kind: 'fact',
      content: 'Builds take ten minutes',
      sourceAgentId: 'memory',
    })
    const proposal = await propose(db, context(), {
      space,
      payload: {
        type: 'record',
        kind: 'fact',
        content: 'Builds take five minutes',
        replaces: target,
      },
      sourceIds: ['evidence'],
    })
    await applyOperation(db, context(), {
      type: 'invalidate',
      id: target,
      revision: (await record(target))?.revision ?? 0,
      reason: 'measured again',
    })

    await exports.default.decideProposal(proposal.id, {
      decision: 'accept',
      reason: 'ok',
      decidedBy: 'reviewer',
    })

    await waitForProposal(proposal.id, 'conflict')
  })

  it('promotes a skill and archives each source that now loads the shared skill', async () => {
    const space = `space-${crypto.randomUUID().slice(0, 8)}`
    const reader = crypto.randomUUID()
    const outsider = crypto.randomUUID()
    const skillMd = '---\nname: deploy\ndescription: How to deploy\n---\n\nRun the deploy.\n'
    for (const agentId of [reader, outsider]) {
      const result = await writeSkill(db, env.ARCHIVE, context(), {
        scope: `agent:${agentId}`,
        name: 'deploy',
        files: { 'SKILL.md': skillMd },
        baseRevision: undefined,
        status: 'active',
        evidence: 'test',
      })
      expect(result.status).toBe('applied')
    }
    using config = await exports.default.getConfig(reader)
    await exports.default.setConfig(reader, { ...config, sharedSpaces: [space, 'global'] })
    const files = await skillFilesAsBlobs(env.ARCHIVE, `agent:${reader}`, 'deploy')
    const proposal = await propose(db, context(), {
      space,
      payload: { type: 'skill', name: 'deploy', files, remove: [] },
      sourceIds: [`agent:${reader}/deploy`, `agent:${outsider}/deploy`],
    })
    const [summary] = await exports.default.listProposals(space)
    expect(summary?.skillFiles?.[0]?.content).toContain('Run the deploy.')

    await exports.default.decideProposal(proposal.id, {
      decision: 'accept',
      reason: 'ok',
      decidedBy: 'reviewer',
    })
    await waitForProposal(proposal.id, 'applied')

    const skill = (scope: Scope) =>
      db
        .select()
        .from(skills)
        .where(and(eq(skills.scope, scope), eq(skills.name, 'deploy')))
        .get()
    expect((await skill(`shared:${space}`))?.status).toBe('active')
    expect(await skill(`agent:${reader}`)).toMatchObject({
      status: 'archived',
      absorbedInto: `shared:${space}/deploy`,
    })
    expect((await skill(`agent:${outsider}`))?.status).toBe('active')
    const kept = await db
      .select()
      .from(memoryLedger)
      .where(
        and(
          eq(memoryLedger.action, 'keep_source'),
          eq(memoryLedger.targetId, `agent:${outsider}/deploy`),
        ),
      )
    expect(kept).toHaveLength(1)
  })

  it('lets the memory agent propose, but not write, shared records', async () => {
    const agentId = crypto.randomUUID()
    const space = `space-${crypto.randomUUID().slice(0, 8)}`
    const fact = await write({
      scope: `agent:${agentId}`,
      kind: 'fact',
      content: 'The API rate limit is 600 per minute',
      sourceAgentId: agentId,
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = requestBody(init)
      if (!body.includes(`Job: consolidate scope agent:${agentId}`)) return textResponse('Nothing.')
      if (toolResults(body) === 0) {
        return toolCallResponse({
          name: 'shared_propose',
          arguments: {
            space,
            record: { kind: 'fact', content: 'The API rate limit is 600 per minute' },
            sourceIds: [fact],
          },
        })
      }
      return textResponse('Proposed.')
    })

    const status = await env.MEMORY_AGENT.getByName(MEMORY_AGENT_NAME).enqueue({
      kind: 'consolidate',
      scope: `agent:${agentId}`,
      day: '2026-10-21',
    })
    await expect
      .poll(
        async () =>
          (await env.MEMORY_AGENT.getByName(MEMORY_AGENT_NAME).jobStatus(status.jobId))?.status,
        { timeout: 10_000 },
      )
      .toBe('settled')

    const pending = await exports.default.listProposals(space)
    expect(pending.map((summary) => summary.payload)).toEqual([
      { type: 'record', kind: 'fact', content: 'The API rate limit is 600 per minute' },
    ])
  })
})
