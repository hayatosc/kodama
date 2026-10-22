/**
 * Tools of a consolidate job of an agent scope that list, read, write, and archive its skills.
 *
 * @module
 */
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'
import type { ToolExecutionApi, ToolRegistration } from '@earendil-works/pi-durable'
import { sha256Hex } from '../../lib/hash.ts'
import {
  listSkills,
  MAX_SKILL_BODY,
  MAX_SKILL_DESCRIPTION,
  readSkill,
  setSkillStatus,
  writeSkill,
} from '../skills.ts'
import type { OperationContext } from '../store/statements.ts'
import { describe, text, toolDb } from './common.ts'
import type { MemoryToolDeps } from './common.ts'

const NAME = Type.String({ pattern: '^[a-z0-9-]{1,64}$' })

/** The skill tools; each refuses to run outside a consolidate job of an agent scope. */
export function skillTools(deps: MemoryToolDeps): ToolRegistration[] {
  /** The agent whose skills the running job may change, and the operation of one tool call. */
  const skillJob = async (
    api?: ToolExecutionApi,
  ): Promise<{ agentId: string; context: OperationContext }> => {
    const running = await deps.runningJob()
    if (running?.job.kind !== 'consolidate' || !running.job.scope.startsWith('agent:')) {
      throw new Error('Skills change only in a consolidate job of an agent scope')
    }
    const { jobId } = running
    return {
      agentId: running.job.scope.slice('agent:'.length),
      context: {
        opId: await sha256Hex(`${jobId}:${api?.callId ?? ''}`),
        jobId,
        runId: jobId,
        actor: 'memory-agent',
        now: deps.now?.() ?? Date.now(),
      },
    }
  }

  return [
    defineTool({
      name: 'list_skills',
      description: 'List the skills of the agent of a consolidate job, with status and revision.',
      parameters: Type.Object({}),
      replay: 'safe',
      execute: async () => {
        const { agentId } = await skillJob()
        const rows = await listSkills(toolDb(deps), agentId)
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
        const { agentId } = await skillJob()
        const skill = await readSkill(toolDb(deps), agentId, name)
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
        const { agentId, context } = await skillJob(api)
        return text(describe(await writeSkill(toolDb(deps), context, { agentId, ...args })))
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
        const { agentId, context } = await skillJob(api)
        const status = restore === true ? 'active' : 'archived'
        return text(
          describe(
            await setSkillStatus(toolDb(deps), context, { agentId, name, revision, status }),
          ),
        )
      },
    }),
  ]
}
