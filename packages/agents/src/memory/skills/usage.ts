/** Which skills an agent sees, and how often it uses them (docs/memory.md, Listing and loading). */
import { and, eq, inArray } from 'drizzle-orm'
import type { MemoryDb } from '../store/db.ts'
import { skills, skillUsage } from '../../../drizzle/d1/schema/skills.ts'
import type { Scope } from '../../../drizzle/d1/schema/records.ts'
import { readableScopes } from '../store/scopes.ts'
import { errorText } from '../store/statements.ts'
import type { Skill, VisibleSkill } from './paths.ts'

export const SKILL_LIST_LIMIT = 50

/**
 * The skills an agent sees: its own, then shared ones whose name it does not use, the earlier
 * shared space winning. Agent skills first, then shared by this agent's uses and all agents' uses.
 */
export async function visibleSkills(
  db: MemoryDb,
  agentId: string,
  sharedSpaces: readonly string[],
): Promise<VisibleSkill[]> {
  const scopes = readableScopes(agentId, sharedSpaces)
  const rows = await db
    .select()
    .from(skills)
    .where(and(inArray(skills.scope, scopes), inArray(skills.status, ['active', 'stale'])))
  if (rows.length === 0) return []
  const usage = await db.select().from(skillUsage).where(inArray(skillUsage.scope, scopes))
  const uses = (skill: Skill, mine: boolean) =>
    usage
      .filter(
        (u) => u.scope === skill.scope && u.name === skill.name && (!mine || u.agentId === agentId),
      )
      .reduce((sum, u) => sum + u.useCount, 0)
  const own = scopes[0]
  const agentSkills = rows
    .filter((skill) => skill.scope === own)
    .sort((a, b) => uses(b, true) - uses(a, true))
  const taken = new Set(agentSkills.map((skill) => skill.name))
  const shared: Skill[] = []
  for (const scope of scopes.slice(1)) {
    for (const skill of rows.filter((row) => row.scope === scope)) {
      if (taken.has(skill.name)) continue
      taken.add(skill.name)
      shared.push(skill)
    }
  }
  shared.sort((a, b) => uses(b, true) - uses(a, true) || uses(b, false) - uses(a, false))
  return [...agentSkills, ...shared]
    .slice(0, SKILL_LIST_LIMIT)
    .map(({ scope, name, description }) => ({ scope, name, description }))
}

/** Count one use of a skill by an agent; a skill removed meanwhile is ignored. */
export async function recordSkillUse(
  db: MemoryDb,
  skill: { scope: Scope; name: string },
  agentId: string,
  now: number,
): Promise<void> {
  const key = and(
    eq(skillUsage.scope, skill.scope),
    eq(skillUsage.name, skill.name),
    eq(skillUsage.agentId, agentId),
  )
  try {
    // Only this agent writes its row; a use counted twice at the same moment may be lost.
    const current = await db.select().from(skillUsage).where(key).get()
    const useCount = (current?.useCount ?? 0) + 1
    await db
      .insert(skillUsage)
      .values({ scope: skill.scope, name: skill.name, agentId, useCount, lastUsedAt: now })
      .onConflictDoUpdate({
        target: [skillUsage.scope, skillUsage.name, skillUsage.agentId],
        set: { useCount, lastUsedAt: now },
      })
  } catch (error) {
    if (!/constraint/i.test(errorText(error))) throw error
  }
}
