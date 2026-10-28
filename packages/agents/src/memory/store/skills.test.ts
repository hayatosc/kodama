/**
 * Skill writes, reads and retention preserve explicit user and memory-agent decisions.
 *
 * @module
 */
import { uuidv7 } from '../../lib/uuid.ts'
import { env, exports } from 'cloudflare:workers'
import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { skills } from '../../../drizzle/memory/schema.ts'
import { MEMORY_AGENT_NAME } from '../jobs.ts'
import { curateSkills, readSkill, setSkillStatus, visibleSkills, writeSkill } from './skills.ts'
import { SKILL_LIST_LIMIT } from '../skills.ts'
import type { SkillWrite } from '../skills.ts'
import {
  isMemoryAgentRequest,
  requestBody,
  textResponse,
  toolCallResponse,
  toolResults,
} from '../../helper/model.ts'
import { context, db } from '../../helper/memory.ts'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'
import { newAgentId } from '../../helper/management.ts'

const DAY = 24 * 60 * 60 * 1000

afterEach(() => vi.restoreAllMocks())

function skill(agentId: string, name: string, body: string): SkillWrite {
  return { agentId, name, description: `How to ${name}`, body, evidence: 'entries 4-9' }
}

async function create(agentId: string, name: string, body: string): Promise<void> {
  expect((await writeSkill(db, context(), skill(agentId, name, body))).status).toBe('applied')
}

describe('writing skills', () => {
  it('creates a skill, updates it only at the revision read, and applies a repeat once', async () => {
    const agentId = await newAgentId()
    const created = context()
    await writeSkill(db, created, skill(agentId, 'deploy', 'Run deploy.'))
    const repeat = await writeSkill(db, created, skill(agentId, 'deploy', 'Run deploy.'))

    const stale = await writeSkill(db, context(), {
      ...skill(agentId, 'deploy', 'Old view.'),
      revision: 7,
    })
    const updated = await writeSkill(db, context(), {
      ...skill(agentId, 'deploy', 'Run deploy --env production.'),
      revision: 1,
    })

    expect(repeat.replayed).toBe(true)
    expect(stale.status).toBe('conflict')
    expect(updated.status).toBe('applied')
    const row = await readSkill(db, agentId, 'deploy')
    expect(row).toMatchObject({ body: 'Run deploy --env production.', revision: 2 })
  })
})

describe('skills in a working agent', () => {
  it('lists at most 50 active skills, most recently written or used first', async () => {
    const agentId = uuidv7()
    for (let index = 0; index <= 50; index++) {
      const written = await writeSkill(
        db,
        context(1_000 + index),
        skill(agentId, `step-${index}`, 'Do it.'),
      )
      expect(written.status).toBe('applied')
    }

    const listed = (await visibleSkills(db, agentId)).map((row) => row.name)

    expect(SKILL_LIST_LIMIT).toBe(50)
    expect(listed).toHaveLength(50)
    expect(listed[0]).toBe('step-50')
    expect(listed).not.toContain('step-0')
  })

  it('lists only its active skills and reads one with skill_read, counting the use', async () => {
    const agentId = await newAgentId()
    await create(agentId, 'deploy', 'Run wrangler deploy --env production.')
    await create(agentId, 'old', 'Archived.')
    await create(uuidv7(), 'secret', 'Not yours.')
    await setSkillStatus(db, context(), { agentId, name: 'old', revision: 1, status: 'archived' })
    expect((await visibleSkills(db, agentId)).map((row) => row.name)).toEqual(['deploy'])

    const bodies: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = requestBody(init)
      if (isMemoryAgentRequest(body)) return textResponse('Nothing.')
      bodies.push(body)
      return toolResults(body) === 0
        ? toolCallResponse({ name: 'skill_read', arguments: { name: 'deploy' } })
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

    expect(bodies[0]).toContain('- deploy: How to deploy')
    expect(bodies[0]).not.toContain('- secret:')
    expect(bodies.at(-1)).toContain('Run wrangler deploy --env production.')
    expect((await readSkill(db, agentId, 'deploy'))?.useCount).toBe(1)
  })
})

describe('skill curation', () => {
  it('keeps a restored skill at the next curation and restarts its retention period', async () => {
    const agentId = await newAgentId()
    const now = Date.now()
    await writeSkill(
      db,
      { ...context(), now: now - 40 * DAY },
      skill(agentId, 'restored', 'Keep me.'),
    )
    await curateSkills(db, 'archive-old', now)
    const archived = await readSkill(db, agentId, 'restored')
    expect(archived?.status).toBe('archived')
    const restore = { ...context(), now }
    const target = {
      agentId,
      name: 'restored',
      revision: archived?.revision ?? 0,
      status: 'active',
    } as const
    expect((await setSkillStatus(db, restore, target)).status).toBe('applied')
    expect((await setSkillStatus(db, { ...restore, now: now + DAY }, target)).replayed).toBe(true)
    await curateSkills(db, 'next-day', now + DAY)
    expect(await readSkill(db, agentId, 'restored')).toMatchObject({
      status: 'active',
      updatedAt: now,
    })
    await curateSkills(db, 'unused-again', now + 31 * DAY)
    expect((await readSkill(db, agentId, 'restored'))?.status).toBe('archived')
  })

  it('archives a skill unused for 30 days and keeps one used since', async () => {
    const agentId = await newAgentId()
    await create(agentId, 'idle', 'Unused.')
    await create(agentId, 'busy', 'Used.')
    const now = Date.now()
    await db
      .update(skills)
      .set({ lastUsedAt: now + 20 * DAY })
      .where(and(eq(skills.agentId, agentId), eq(skills.name, 'busy')))

    await curateSkills(db, 'curate', now + 31 * DAY)

    expect((await readSkill(db, agentId, 'idle'))?.status).toBe('archived')
    expect((await readSkill(db, agentId, 'busy'))?.status).toBe('active')
  })

  it('writes a skill from a consolidate job of the memory agent', async () => {
    const agentId = await newAgentId()
    const scope = `agent:${agentId}` as const
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
            description: 'Find the commit that caused a regression',
            body: 'Run git bisect.',
            evidence: 'entries 4-9 and 30-41',
          },
        })
      }
      return textResponse('Wrote a skill.')
    })

    const memoryAgent = env.AGENTS.getByName(MEMORY_AGENT_NAME)
    const status = await memoryAgent.enqueue({ kind: 'consolidate', scope, day: '2026-10-21' })

    await expect
      .poll(async () => (await memoryAgent.jobStatus(status.jobId))?.outcome, { timeout: 10_000 })
      .toBe('persisted')
    expect((await readSkill(db, agentId, 'bisect'))?.body).toBe('Run git bisect.')
  })
})
