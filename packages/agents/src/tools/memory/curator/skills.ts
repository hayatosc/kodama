/**
 * Tools of a consolidate job of an agent scope that list, read, write, and archive its skills.
 *
 * @module
 */
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'
import type { ToolExecutionApi, ToolRegistration } from '@earendil-works/pi-durable'
import { MAX_SKILL_BODY, MAX_SKILL_DESCRIPTION } from '../../../memory/skills.ts'
import { listSkills, readSkill, setSkillStatus, writeSkill } from '../../../memory/store/skills.ts'
import { memoryDb } from '../../../memory/store/db.ts'
import { skillJobContext } from '../../../memory/extraction/operations.ts'
import { describe, text } from './common.ts'
import type { MemoryJobDeps } from '../../../memory/extraction/context.ts'

const NAME = Type.String({ pattern: '^[a-z0-9-]{1,64}$' })

/** The skill tools; each refuses to run outside a consolidate job of an agent scope. */
export function skillTools(deps: MemoryJobDeps): ToolRegistration[] {
  const db = memoryDb(deps.env.MEMORY_DB)

  return [
    defineTool({
      name: 'list_skills',
      description: 'List the skills of the agent of a consolidate job, with status and revision.',
      parameters: Type.Object({}),
      replay: 'safe',
      execute: async () => {
        const { agentId } = await skillJobContext(deps)
        const rows = await listSkills(db, agentId)
        const lines = rows.map(
          (row) =>
            `- ${row.name} status=${row.status} revision=${row.revision}: ${row.description}`,
        )
        return text(lines.length === 0 ? 'No skills.' : lines.join('\n'))
      },
    }),
    defineTool({
      name: 'read_skill',
      description: 'Read the body and evidence of a skill of the job agent.',
      parameters: Type.Object({ name: NAME }),
      replay: 'safe',
      execute: async ({ name }) => {
        const { agentId } = await skillJobContext(deps)
        const skill = await readSkill(db, agentId, name)
        if (skill === undefined) throw new Error(`No skill ${name}`)
        return text(`revision=${skill.revision}\nevidence: ${skill.evidence}\n\n${skill.body}`)
      },
    }),
    defineTool({
      name: 'skill_write',
      description:
        'Create or overwrite a skill of the job agent: a short description of when to use it, and the steps as Markdown. Pass the revision you read to update; omit it to create.',
      parameters: Type.Object({
        name: NAME,
        description: Type.String({ minLength: 1, maxLength: MAX_SKILL_DESCRIPTION }),
        body: Type.String({ minLength: 1, maxLength: MAX_SKILL_BODY }),
        evidence: Type.String({
          minLength: 1,
          maxLength: 2_000,
          description: 'The entry ranges where the procedure worked, and lessons from failures',
        }),
        revision: Type.Optional(Type.Integer({ minimum: 1 })),
      }),
      replay: 'safe',
      execute: async (args, api: ToolExecutionApi) => {
        const { agentId, context } = await skillJobContext(deps, api.callId)
        return text(describe(await writeSkill(db, context, { agentId, ...args })))
      },
    }),
    defineTool({
      name: 'skill_archive',
      description:
        'Archive a skill of the job agent at the revision you read, or restore an archived one.',
      parameters: Type.Object({
        name: NAME,
        revision: Type.Integer({ minimum: 1 }),
        restore: Type.Optional(Type.Boolean()),
      }),
      replay: 'safe',
      execute: async ({ name, revision, restore }, api: ToolExecutionApi) => {
        const { agentId, context } = await skillJobContext(deps, api.callId)
        const status = restore === true ? 'active' : 'archived'
        return text(
          describe(await setSkillStatus(db, context, { agentId, name, revision, status })),
        )
      },
    }),
  ]
}
