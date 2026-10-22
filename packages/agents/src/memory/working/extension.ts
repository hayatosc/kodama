/**
 * The extension that gives a working agent its memory and skills, whatever its tool choice.
 *
 * @see docs/memory.md — Working agents
 *
 * @module
 */
import { defineExtension, section } from '@earendil-works/pi-durable'
import type { Extension } from '@earendil-works/pi-durable'
import type { VisibleSkill } from '../skills.ts'
import { storedMemoryText, storedSkills } from './always-loaded.ts'
import type { WorkingMemoryDeps } from './deps.ts'
import { historySearchTool, memorySearchTool, rememberTool, skillReadTool } from './tools.ts'

function skillsText(skills: readonly VisibleSkill[]): string | undefined {
  if (skills.length === 0) return undefined
  return [
    'Skills: procedures saved from earlier work. Before a task one of them covers, read it with skill_read and follow it.',
    ...skills.map((skill) => `- ${skill.name}: ${skill.description}`),
  ].join('\n')
}

/** Tools and the always-loaded sections every working agent gets, whatever its tool choice. */
export function createWorkingMemoryExtension(deps: WorkingMemoryDeps): Extension {
  return defineExtension({
    name: 'kodama-memory',
    tools: [
      memorySearchTool(deps),
      rememberTool(deps),
      historySearchTool(deps),
      skillReadTool(deps),
    ],
    sections: [
      section('memory', async () => {
        const text = await storedMemoryText(deps)
        return text.length === 0 ? undefined : text
      }),
      section('skills', async () => skillsText(await storedSkills(deps))),
    ],
  })
}
