/** Helpers of the skill tests: writing a skill and reading it back. */
import { env } from 'cloudflare:workers'
import { and, eq } from 'drizzle-orm'
import { expect } from 'vitest'
import { skillDir } from '../memory/skills/paths.ts'
import { writeSkill } from '../memory/skills/write.ts'
import { skills } from '../../drizzle/d1/schema.ts'
import type { Scope } from '../../drizzle/d1/schema.ts'
import { context, db } from './memory.ts'

export function skillMd(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`
}

/** Write an active skill with this body and files. */
export async function create(
  scope: Scope,
  name: string,
  body: string,
  files: Record<string, string> = {},
): Promise<void> {
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

export function row(scope: Scope, name: string) {
  return db
    .select()
    .from(skills)
    .where(and(eq(skills.scope, scope), eq(skills.name, name)))
    .get()
}

export async function file(scope: Scope, name: string, path: string): Promise<string | undefined> {
  return (await env.ARCHIVE.get(`${skillDir(scope, name)}${path}`))?.text()
}
