/** The extension that gives a working agent its memory and skills, whatever its tool choice. */
import { defineExtension, hook, section, ToolTask } from '@earendil-works/pi-durable'
import type { Extension } from '@earendil-works/pi-durable'
import { createReadTool } from '@earendil-works/pi-durable/tools'
import { isSkillName, skillPath } from '../skills/paths.ts'
import { recordSkillUse } from '../skills/usage.ts'
import type { VisibleSkill } from '../skills/paths.ts'
import { memoryDb } from '../store/db.ts'
import type { Scope } from '../store/schema.ts'
import { isScope } from '../store/scopes.ts'
import type { AlwaysLoadedMemory } from './always-loaded.ts'
import type { WorkingMemoryDeps } from './deps.ts'
import { historySearchTool, memorySearchTool, rememberTool } from './tools.ts'

function skillsText(skills: readonly VisibleSkill[]): string | undefined {
  if (skills.length === 0) return undefined
  return [
    'Skills: procedures saved from earlier work. Before a task one of them covers, read its SKILL.md with the read tool and follow it; read its other files only when it says to.',
    ...skills.map((skill) => `- ${skill.name}: ${skill.description} (${skillPath(skill)})`),
  ].join('\n')
}

/** The skill a `read` of a `SKILL.md` path loads, if any; relative paths start at `/skills`. */
export function skillOfPath(path: string): { scope: Scope; name: string } | undefined {
  const absolute = path.startsWith('/') ? path : `/skills/${path}`
  const match = /^\/skills\/([^/]+)\/([^/]+)\/SKILL\.md$/.exec(absolute)
  const scope = match?.[1]
  const name = match?.[2]
  if (scope === undefined || name === undefined || !isScope(scope) || !isSkillName(name)) {
    return undefined
  }
  return { scope, name }
}

/** Tools and the always-loaded section every working agent gets, whatever its tool choice. */
export function createWorkingMemoryExtension(
  deps: WorkingMemoryDeps,
  memory: AlwaysLoadedMemory,
): Extension {
  return defineExtension({
    name: 'kodama-memory',
    tools: [memorySearchTool(deps), rememberTool(deps), historySearchTool(deps), createReadTool()],
    sections: [
      section('memory', async () => {
        const text = await memory.text()
        return text.length === 0 ? undefined : text
      }),
      section('skills', async () => skillsText(await memory.skills())),
    ],
    hooks: [
      hook(ToolTask, {
        afterTool: async (call, result) => {
          const path: unknown = call.arguments['path']
          const skill = typeof path === 'string' ? skillOfPath(path) : undefined
          if (call.name !== 'read' || skill === undefined || result.isError === true)
            return undefined
          try {
            await recordSkillUse(
              memoryDb(deps.env.MEMORY_DB),
              skill,
              deps.agentId(),
              deps.now?.() ?? Date.now(),
            )
          } catch (error) {
            console.error('Skill use was not recorded', error)
          }
          return undefined
        },
      }),
    ],
  })
}
