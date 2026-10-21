import { env, exports } from 'cloudflare:workers'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { ExecutionEnv } from '@earendil-works/pi-durable/env'
import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { skills, skillUsage } from '../../../drizzle/d1/schema.ts'
import type { Scope } from '../../../drizzle/d1/schema.ts'
import { SkillsEnv } from './env.ts'
import { curateSkills } from './curation.ts'
import { setSkillStatus } from './status.ts'
import { visibleSkills } from './usage.ts'
import { MEMORY_AGENT_NAME } from '../jobs.ts'
import {
  isMemoryAgentRequest,
  requestBody,
  textResponse,
  toolCallResponse,
  toolResults,
} from '../../helper/model.ts'
import { context, db } from '../../helper/memory.ts'
import { create, file, row, skillMd } from '../../helper/skills.ts'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'

const DAY = 24 * 60 * 60 * 1000

afterEach(() => vi.restoreAllMocks())

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
