import { env, exports } from 'cloudflare:workers'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { ExecutionEnv } from '@earendil-works/pi-durable/env'
import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { memoryDb } from '../src/memory/store/db.ts'
import type { OperationContext } from '../src/memory/store/statements.ts'
import type { Scope } from '../src/memory/store/schema/records.ts'
import { memoryLedger } from '../src/memory/store/schema/records.ts'
import { skills, skillUsage, skillWrites } from '../src/memory/store/schema/skills.ts'
import { SkillsEnv } from '../src/memory/skills/env.ts'
import { curateSkills } from '../src/memory/skills/curation.ts'
import { finishPendingSkillWrites, writeSkill } from '../src/memory/skills/write.ts'
import { rollbackSkill, setSkillStatus } from '../src/memory/skills/status.ts'
import { skillDir } from '../src/memory/skills/paths.ts'
import { visibleSkills } from '../src/memory/skills/usage.ts'
import { MEMORY_AGENT_NAME } from '../src/memory/memory-agent/jobs.ts'
import {
  isMemoryAgentRequest,
  requestBody,
  textResponse,
  toolCallResponse,
  toolResults,
} from './model.ts'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'

const db = memoryDb(env.MEMORY_DB)
const DAY = 24 * 60 * 60 * 1000

afterEach(() => vi.restoreAllMocks())

function context(now = Date.now()): OperationContext {
  const opId = crypto.randomUUID()
  return { opId, jobId: opId, runId: opId, actor: 'test', now }
}

function skillMd(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`
}

async function create(
  scope: Scope,
  name: string,
  body: string,
  files: Record<string, string> = {},
) {
  const result = await writeSkill(db, env.ARCHIVE, context(), {
    scope,
    name,
    files: { 'SKILL.md': skillMd(name, `How to ${name}`, body), ...files },
    baseRevision: undefined,
    status: 'active',
    evidence: 'test',
  })
  expect(result.status).toBe('applied')
}

function row(scope: Scope, name: string) {
  return db
    .select()
    .from(skills)
    .where(and(eq(skills.scope, scope), eq(skills.name, name)))
    .get()
}

async function file(scope: Scope, name: string, path: string): Promise<string | undefined> {
  return (await env.ARCHIVE.get(`${skillDir(scope, name)}${path}`))?.text()
}

describe('skill storage', () => {
  it('overwrites a skill in place, guarded by the revision the writer read', async () => {
    const scope: Scope = `agent:${crypto.randomUUID()}`
    await create(scope, 'deploy', 'Run wrangler deploy.', { 'references/env.md': 'Use prod.' })
    const first = await row(scope, 'deploy')

    const update = await writeSkill(db, env.ARCHIVE, context(), {
      scope,
      name: 'deploy',
      files: {
        'SKILL.md': skillMd('deploy', 'How to deploy', 'Run pnpm deploy.'),
        'references/env.md': null,
      },
      baseRevision: first?.revision,
      status: 'active',
      evidence: 'test',
    })
    const stale = await writeSkill(db, env.ARCHIVE, context(), {
      scope,
      name: 'deploy',
      files: { 'SKILL.md': skillMd('deploy', 'How to deploy', 'Something else.') },
      baseRevision: first?.revision,
      status: 'active',
      evidence: 'test',
    })

    expect(update.status).toBe('applied')
    expect(stale).toMatchObject({ status: 'conflict', reason: 'target_changed' })
    expect(await file(scope, 'deploy', 'SKILL.md')).toContain('Run pnpm deploy.')
    expect(await file(scope, 'deploy', 'references/env.md')).toBeUndefined()
    expect((await row(scope, 'deploy'))?.revision).toBe(2)
    expect((await row(scope, 'deploy'))?.contentSha256).not.toBe(first?.contentSha256)
  })

  it('rejects a skill whose SKILL.md lacks matching frontmatter, or a file outside its folders', async () => {
    const scope: Scope = `agent:${crypto.randomUUID()}`
    const attempt = (files: Record<string, string>) =>
      writeSkill(db, env.ARCHIVE, context(), {
        scope,
        name: 'deploy',
        files,
        baseRevision: undefined,
        status: 'active',
        evidence: 'test',
      }).then(
        () => 'written',
        (error: unknown) => String(error),
      )

    expect(await attempt({ 'SKILL.md': 'No frontmatter' })).toMatch(/frontmatter/)
    expect(await attempt({ 'SKILL.md': skillMd('other', 'x', 'y') })).toMatch(/name must match/)
    expect(await attempt({ 'SKILL.md': skillMd('deploy', 'x', 'y'), '../escape.md': 'z' })).toMatch(
      /Invalid skill file path/,
    )
    expect(await row(scope, 'deploy')).toBeUndefined()
  })

  it('finishes a write that stopped while the directory was being overwritten', async () => {
    const scope: Scope = `agent:${crypto.randomUUID()}`
    await create(scope, 'release', 'Old steps.', { 'references/notes.md': 'old notes' })
    const base = (await row(scope, 'release'))?.revision
    // Writes to the directory fail after the blobs and the pending row are stored.
    const stopping = new Proxy(env.ARCHIVE, {
      get(target, property, receiver) {
        if (property === 'put') {
          return (key: string, value: string | ArrayBuffer, options?: R2PutOptions) =>
            key.startsWith('skills/.blobs/')
              ? target.put(key, value, options)
              : Promise.reject(new Error('stopped'))
        }
        const value: unknown = Reflect.get(target, property, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })

    const ctx = context()
    const stopped = await writeSkill(db, stopping, ctx, {
      scope,
      name: 'release',
      files: {
        'SKILL.md': skillMd('release', 'How to release', 'New steps.'),
        'references/notes.md': 'new notes',
      },
      baseRevision: base,
      status: 'active',
      evidence: 'test',
    }).then(
      () => 'finished',
      (error: unknown) => String(error),
    )
    expect(stopped).toMatch(/stopped/)
    expect(await file(scope, 'release', 'SKILL.md')).toContain('Old steps.')

    expect(await finishPendingSkillWrites(db, env.ARCHIVE, Date.now())).toBeGreaterThanOrEqual(1)

    expect(await file(scope, 'release', 'SKILL.md')).toContain('New steps.')
    expect(await file(scope, 'release', 'references/notes.md')).toBe('new notes')
    expect((await row(scope, 'release'))?.revision).toBe((base ?? 0) + 1)
    const write = await db.select().from(skillWrites).where(eq(skillWrites.opId, ctx.opId)).get()
    expect(write?.status).toBe('done')
  })

  it('rolls a write back to the files it replaced', async () => {
    const scope: Scope = `agent:${crypto.randomUUID()}`
    await create(scope, 'review', 'Check tests first.')
    const before = await row(scope, 'review')
    await writeSkill(db, env.ARCHIVE, context(), {
      scope,
      name: 'review',
      files: { 'SKILL.md': skillMd('review', 'How to review', 'Skip tests.') },
      baseRevision: before?.revision,
      status: 'active',
      evidence: 'test',
    })
    const write = (
      await db
        .select()
        .from(memoryLedger)
        .where(and(eq(memoryLedger.targetId, `${scope}/review`), eq(memoryLedger.action, 'write')))
    ).at(-1)

    const result = await rollbackSkill(db, env.ARCHIVE, context(), write?.seq ?? 0)

    expect(result.status).toBe('applied')
    expect(await file(scope, 'review', 'SKILL.md')).toContain('Check tests first.')
    expect((await row(scope, 'review'))?.contentSha256).toBe(before?.contentSha256)
  })
})

describe('skill visibility', () => {
  it('lets an agent skill shadow a shared one and the earlier shared space win', async () => {
    const agentId = crypto.randomUUID()
    const first = `first-${agentId.slice(0, 8)}`
    const second = `second-${agentId.slice(0, 8)}`
    await create(`shared:${first}`, 'deploy', 'Shared deploy.')
    await create(`shared:${second}`, 'deploy', 'Other shared deploy.')
    await create(`shared:${second}`, 'triage', 'Shared triage.')
    await create(`agent:${agentId}`, 'triage', 'My triage.')
    await create(`agent:${agentId}`, 'old', 'Archived.')
    const old = await row(`agent:${agentId}`, 'old')
    await setSkillStatus(db, context(), {
      scope: `agent:${agentId}`,
      name: 'old',
      revision: old?.revision ?? 0,
      status: 'archived',
    })

    const visible = await visibleSkills(db, agentId, [first, second])

    expect(visible.map((skill) => `${skill.scope}/${skill.name}`)).toEqual([
      `agent:${agentId}/triage`,
      `shared:${first}/deploy`,
    ])
  })

  it('serves only visible skills, read-only, through SkillsEnv', async () => {
    const agentId = crypto.randomUUID()
    await create(`agent:${agentId}`, 'deploy', 'Run deploy.')
    await create(`agent:${crypto.randomUUID()}`, 'secret', 'Not yours.')
    const skillsEnv: ExecutionEnv = new SkillsEnv(env.ARCHIVE, await visibleSkills(db, agentId, []))
    const ctx = BACKGROUND_CONTEXT

    const own = await skillsEnv.readTextFile(`/skills/agent:${agentId}/deploy/SKILL.md`, ctx)
    const relative = await skillsEnv.exists(`agent:${agentId}/deploy/SKILL.md`, ctx)
    const escape = await skillsEnv.exists(`/skills/agent:${agentId}/deploy/../../../x`, ctx)
    const write = await skillsEnv.writeFile(`/skills/agent:${agentId}/deploy/SKILL.md`, 'x', ctx)
    const listing = await skillsEnv.listDir('/skills', ctx)

    expect(own.ok && own.value).toContain('Run deploy.')
    expect(relative).toEqual({ ok: true, value: true })
    expect(escape).toEqual({ ok: true, value: false })
    expect(write.ok).toBe(false)
    expect(listing.ok && listing.value.map((entry) => entry.name)).toEqual([`agent:${agentId}`])
  })
})

describe('skills in a working agent', () => {
  it('lists the skill, loads it with the read tool, and counts the use', async () => {
    const agentId = crypto.randomUUID()
    const scope: Scope = `agent:${agentId}`
    await create(scope, 'deploy', 'Run wrangler deploy --env production.')
    const bodies: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = requestBody(init)
      if (isMemoryAgentRequest(body)) return textResponse('Nothing.')
      bodies.push(body)
      return toolResults(body) === 0
        ? toolCallResponse({
            name: 'read',
            arguments: { path: `/skills/${scope}/deploy/SKILL.md` },
          })
        : textResponse('Deployed.')
    })

    await exports.default.sendMessage(agentId, { requestId: 'deploy', content: 'Deploy it' })
    await expect
      .poll(
        async () => {
          using result = await exports.default.submission(agentId, 'deploy')
          return result?.submission.status
        },
        { timeout: 10_000 },
      )
      .toBe('done')

    expect(bodies[0]).toContain(`/skills/${scope}/deploy/SKILL.md`)
    expect(bodies.at(-1)).toContain('Run wrangler deploy --env production.')
    const usage = await db
      .select()
      .from(skillUsage)
      .where(and(eq(skillUsage.scope, scope), eq(skillUsage.agentId, agentId)))
      .get()
    expect(usage?.useCount).toBe(1)
  })
})

describe('skill curation', () => {
  it('marks unused agent skills stale after 14 days and archived after 30, except pinned ones', async () => {
    const scope: Scope = `agent:${crypto.randomUUID()}`
    await create(scope, 'idle', 'Unused.')
    await create(scope, 'kept', 'Pinned.')
    await db
      .update(skills)
      .set({ pinned: true })
      .where(and(eq(skills.scope, scope), eq(skills.name, 'kept')))
    const now = Date.now()

    await curateSkills(db, 'curate-1', now + 15 * DAY)
    const stale = (await row(scope, 'idle'))?.status
    await curateSkills(db, 'curate-2', now + 31 * DAY)

    expect(stale).toBe('stale')
    expect((await row(scope, 'idle'))?.status).toBe('archived')
    expect((await row(scope, 'kept'))?.status).toBe('active')
  })

  it('writes a skill from a consolidate job of the memory agent', async () => {
    const agentId = crypto.randomUUID()
    const scope: Scope = `agent:${agentId}`
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = requestBody(init)
      const step = toolResults(body)
      if (!body.includes(`Job: consolidate scope ${scope}`)) return textResponse('Nothing.')
      if (step === 0) return toolCallResponse({ name: 'list_skills', arguments: {} })
      if (step === 1) {
        return toolCallResponse({
          name: 'skill_write',
          arguments: {
            name: 'bisect',
            files: [
              { path: 'SKILL.md', content: skillMd('bisect', 'Find a regression', 'git bisect.') },
            ],
            evidence: 'entries 4-9 and 30-41',
          },
        })
      }
      return textResponse('Wrote a skill.')
    })

    const status = await env.MEMORY_AGENT.getByName(MEMORY_AGENT_NAME).enqueue({
      kind: 'consolidate',
      scope,
      day: '2026-10-21',
    })

    await expect
      .poll(
        async () =>
          (await env.MEMORY_AGENT.getByName(MEMORY_AGENT_NAME).jobStatus(status.jobId))?.outcome,
        { timeout: 10_000 },
      )
      .toBe('persisted')
    expect((await row(scope, 'bisect'))?.status).toBe('active')
    expect(await file(scope, 'bisect', 'SKILL.md')).toContain('git bisect.')
  })
})
