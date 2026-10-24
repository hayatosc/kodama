/**
 * The skill tools work only in a consolidate job of an agent scope, on that agent's skills.
 *
 * @module
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { db, runScriptedJob } from '../../helper/memory.ts'
import { readSkill } from '../../memory/store/skills.ts'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'

afterEach(() => vi.restoreAllMocks())

const deploy = {
  name: 'deploy',
  description: 'How to deploy',
  body: 'Run the checks, then deploy.',
  evidence: 'entries 4-9',
}

describe('skill tools', () => {
  it('lists, writes, reads, archives, and restores the skills of the job agent', async () => {
    const agentId = crypto.randomUUID()
    const { outputs } = await runScriptedJob(
      { kind: 'consolidate', scope: `agent:${agentId}`, day: '2026-10-01' },
      [
        { name: 'list_skills', arguments: {} },
        { name: 'skill_write', arguments: deploy },
        { name: 'list_skills', arguments: {} },
        { name: 'read_skill', arguments: { name: 'deploy' } },
        { name: 'skill_archive', arguments: { name: 'deploy', revision: 1 } },
        { name: 'skill_archive', arguments: { name: 'deploy', revision: 2, restore: true } },
      ],
    )

    expect(outputs[0]).toBe('No skills.')
    expect(outputs[1]).toMatch(/^applied /)
    expect(outputs[2]).toBe('- deploy status=active revision=1: How to deploy')
    expect(outputs[3]).toBe('revision=1\nevidence: entries 4-9\n\nRun the checks, then deploy.')
    expect(outputs[4]).toMatch(/^applied /)
    expect(outputs[5]).toMatch(/^applied /)
    expect(await readSkill(db, agentId, 'deploy')).toMatchObject({
      status: 'active',
      revision: 3,
    })
  })

  it('reports a conflict when archiving at a revision that was not read', async () => {
    const agentId = crypto.randomUUID()
    const { outputs } = await runScriptedJob(
      { kind: 'consolidate', scope: `agent:${agentId}`, day: '2026-10-01' },
      [
        { name: 'skill_write', arguments: deploy },
        { name: 'skill_archive', arguments: { name: 'deploy', revision: 5 } },
      ],
    )

    expect(outputs[1]).toMatch(/^conflict/)
    expect(await readSkill(db, agentId, 'deploy')).toMatchObject({ status: 'active' })
  })

  it('reports a skill that does not exist', async () => {
    const { outputs } = await runScriptedJob(
      { kind: 'consolidate', scope: `agent:${crypto.randomUUID()}`, day: '2026-10-01' },
      [{ name: 'read_skill', arguments: { name: 'missing' } }],
    )

    expect(outputs[0]).toContain('No skill missing')
  })

  it('refuses every skill tool outside a consolidate job of an agent scope', async () => {
    const sourceAgentId = crypto.randomUUID()
    const { outputs } = await runScriptedJob(
      {
        kind: 'remember',
        sourceAgentId,
        origin: 'user_request',
        content: 'Keep a deploy skill',
        sourceEntries: { from: 1, to: 1 },
      },
      [
        { name: 'list_skills', arguments: {} },
        { name: 'skill_write', arguments: deploy },
      ],
    )

    for (const output of outputs) {
      expect(output).toContain('Skills change only in a consolidate job of an agent scope')
    }
    expect(await readSkill(db, sourceAgentId, 'deploy')).toBeUndefined()
  })
})
