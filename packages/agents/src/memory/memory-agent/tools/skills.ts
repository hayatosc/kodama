/** Tools of a consolidate job of an agent scope that list, read, write, and archive its skills. */
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'
import type { ToolExecutionApi, ToolRegistration } from '@earendil-works/pi-durable'
import { eq } from 'drizzle-orm'
import { looksLikeInjection, redactSecrets } from '../../redact.ts'
import { setSkillStatus } from '../../skills/status.ts'
import { writeSkill } from '../../skills/write.ts'
import { skillDir } from '../../skills/paths.ts'
import type { MemoryDb } from '../../store/db.ts'
import { skills as skillsTable } from '../../store/schema/skills.ts'
import type { Scope } from '../../store/schema/records.ts'
import { describe, sha256, skillRow, text, toolDb } from './common.ts'
import type { MemoryToolDeps } from './common.ts'

export function skillTools(deps: MemoryToolDeps): ToolRegistration[] {
  const db = (): MemoryDb => toolDb(deps)
  const skillScope = async (): Promise<{ jobId: string; scope: Scope }> => {
    const running = await deps.runningJob()
    if (running?.job.kind !== 'consolidate' || !running.job.scope.startsWith('agent:')) {
      throw new Error('Skills change only in a consolidate job of an agent scope')
    }
    return { jobId: running.jobId, scope: running.job.scope }
  }
  const listSkills = defineTool({
    name: 'list_skills',
    description:
      'List the skills of the agent scope of a consolidate job, with status and revision.',
    parameters: Type.Object({}),
    replay: 'safe',
    execute: async () => {
      const { scope } = await skillScope()
      const rows = await db().select().from(skillsTable).where(eq(skillsTable.scope, scope))
      const lines = rows.map(
        (row) =>
          `- ${row.name} status=${row.status} revision=${row.revision}` +
          `${row.basedOn === null ? '' : ` based_on=${row.basedOn}`}: ${row.description}`,
      )
      return text(lines.length === 0 ? 'No skills.' : lines.join('\n'))
    },
  })
  const readSkill = defineTool({
    name: 'read_skill',
    description: 'Read one file of a skill of the job scope; SKILL.md by default.',
    parameters: Type.Object({
      name: Type.String({ minLength: 1, maxLength: 64 }),
      path: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
    }),
    replay: 'safe',
    execute: async ({ name, path }) => {
      const { scope } = await skillScope()
      const object = await deps.env.ARCHIVE.get(`${skillDir(scope, name)}${path ?? 'SKILL.md'}`)
      if (object === null) throw new Error(`No file ${path ?? 'SKILL.md'} in skill ${name}`)
      return text(await object.text())
    },
  })
  const skillWrite = defineTool({
    name: 'skill_write',
    description:
      'Create or overwrite an agent skill: SKILL.md with name and description frontmatter, and files under references/, assets/, or scripts/. Pass the revision you read to update; omit it to create.',
    parameters: Type.Object({
      name: Type.String({ pattern: '^[a-z0-9-]{1,64}$' }),
      files: Type.Array(
        Type.Object({
          path: Type.String({ minLength: 1, maxLength: 300 }),
          content: Type.String({ maxLength: 200_000 }),
        }),
        { maxItems: 32 },
      ),
      remove: Type.Optional(
        Type.Array(Type.String({ minLength: 1, maxLength: 300 }), { maxItems: 32 }),
      ),
      revision: Type.Optional(Type.Integer({ minimum: 1 })),
      evidence: Type.String({
        minLength: 1,
        maxLength: 2_000,
        description:
          'The trajectories (entry ranges) where the procedure worked, and lessons from failures',
      }),
      basedOn: Type.Optional(
        Type.String({
          pattern: '^shared:[^/]+/[a-z0-9-]+@[0-9a-f]{64}$',
          description: 'For an override of a shared skill: shared:<space>/<name>@<content sha256>',
        }),
      ),
    }),
    replay: 'safe',
    execute: async (args, api: ToolExecutionApi) => {
      const { jobId, scope } = await skillScope()
      const files: Record<string, string | null> = {}
      for (const file of args.files) {
        const content = redactSecrets(file.content)
        if (looksLikeInjection(content))
          throw new Error(`${file.path} reads as instructions to obey`)
        files[file.path] = content
      }
      for (const path of args.remove ?? []) files[path] = null
      const now = deps.now?.() ?? Date.now()
      const result = await writeSkill(
        db(),
        deps.env.ARCHIVE,
        {
          opId: await sha256(`${jobId}:${api.callId}`),
          jobId,
          runId: jobId,
          actor: 'memory-agent',
          now,
        },
        {
          scope,
          name: args.name,
          files,
          baseRevision: args.revision,
          status: 'active',
          evidence: args.evidence,
          ...(args.basedOn === undefined ? {} : { basedOn: args.basedOn }),
        },
      )
      return text(describe(result))
    },
  })
  const skillArchive = defineTool({
    name: 'skill_archive',
    description:
      'Archive a skill of the job scope at the revision you read, or restore an archived one.',
    parameters: Type.Object({
      name: Type.String({ minLength: 1, maxLength: 64 }),
      revision: Type.Integer({ minimum: 1 }),
      restore: Type.Optional(Type.Boolean()),
    }),
    replay: 'safe',
    execute: async ({ name, revision, restore }, api: ToolExecutionApi) => {
      const { jobId, scope } = await skillScope()
      if ((await skillRow(db(), scope, name)) === undefined) throw new Error(`No skill ${name}`)
      const result = await setSkillStatus(
        db(),
        {
          opId: await sha256(`${jobId}:${api.callId}`),
          jobId,
          runId: jobId,
          actor: 'memory-agent',
          now: deps.now?.() ?? Date.now(),
        },
        { scope, name, revision, status: restore === true ? 'active' : 'archived' },
      )
      return text(describe(result))
    },
  })

  return [listSkills, readSkill, skillWrite, skillArchive]
}
