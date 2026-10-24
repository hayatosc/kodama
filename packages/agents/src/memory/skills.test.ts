/**
 * A skill is validated and trimmed before any storage operation.
 *
 * @module
 */
import { describe, expect, it } from 'vitest'
import { checkedSkill, MAX_SKILL_BODY, MAX_SKILL_DESCRIPTION } from './skills.ts'
import type { SkillWrite } from './skills.ts'

const skill: SkillWrite = {
  agentId: 'agent',
  name: 'deploy',
  description: '  How to deploy  ',
  body: '\nRun the checks.\n',
  evidence: 'entries 4-9',
}

describe('checkedSkill', () => {
  it('trims the description and body', () => {
    expect(checkedSkill(skill)).toEqual({
      ...skill,
      description: 'How to deploy',
      body: 'Run the checks.',
    })
  })

  it.each([
    ['an invalid name', { name: 'Deploy Now' }, /Invalid skill name/],
    ['a blank description', { description: '   ' }, /description/],
    ['a long description', { description: 'x'.repeat(MAX_SKILL_DESCRIPTION + 1) }, /description/],
    ['a blank body', { body: '\n' }, /body/],
    ['a long body', { body: 'x'.repeat(MAX_SKILL_BODY + 1) }, /body/],
  ])('rejects %s', (_case, change, message) => {
    expect(() => checkedSkill({ ...skill, ...change })).toThrow(message)
  })
})
