/**
 * Skills: procedures the memory agent writes for one agent, one D1 row each with its body, so a
 * write is one batch that either happens or does not.
 *
 * @see docs/memory.md — Skills
 *
 * @module
 */
import { and, asc, desc, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { skills } from '../../drizzle/d1/schema.ts'
import type { MemoryDb } from './store/db.ts'
import { applyPlan } from './store/records.ts'
import { agentScope } from './store/db.ts'
import { bumpScope, claimRevision, conflict, insertOp, recordLedger } from './store/statements.ts'
import type { OperationContext, OperationResult, Plan, Statements } from './store/statements.ts'

/** A skill row. */
export type Skill = typeof skills.$inferSelect
/** Whether a skill is listed (`active`) or put away (`archived`). */
export type SkillStatus = Skill['status']

/** What a working agent's `skills` section lists. */
export interface VisibleSkill {
  name: string
  description: string
}

/** A skill name: 1–64 lowercase letters, digits, or hyphens. */
export const SKILL_NAME_PATTERN = /^[a-z0-9-]{1,64}$/
/** Longest skill description, in characters. */
export const MAX_SKILL_DESCRIPTION = 1_024
/** Longest skill body, in characters. */
export const MAX_SKILL_BODY = 50_000
/** Skills listed per agent; selection gets worse as the list grows. */
export const SKILL_LIST_LIMIT = 50
/** Days without a use or a write before consolidation archives a skill. */
export const SKILL_ARCHIVE_DAYS = 30
/** Skills archived per consolidation, to keep the step small. */
const CURATE_BATCH = 200

const DAY_MS = 24 * 60 * 60 * 1000

/** Whether `name` is a valid skill name. */
export function isSkillName(name: string): boolean {
  return SKILL_NAME_PATTERN.test(name)
}

function skillKey(agentId: string, name: string): string {
  return `${agentId}/${name}`
}

/** A skill of an agent, in any status. */
export function readSkill(db: MemoryDb, agentId: string, name: string) {
  return db
    .select()
    .from(skills)
    .where(and(eq(skills.agentId, agentId), eq(skills.name, name)))
    .get()
}

/** An agent's skills in any status, by name. */
export function listSkills(db: MemoryDb, agentId: string): Promise<Skill[]> {
  return db.select().from(skills).where(eq(skills.agentId, agentId)).orderBy(asc(skills.name))
}

/** The active skills an agent sees, most recently used or written first. */
export async function visibleSkills(db: MemoryDb, agentId: string): Promise<VisibleSkill[]> {
  return db
    .select({ name: skills.name, description: skills.description })
    .from(skills)
    .where(and(eq(skills.agentId, agentId), eq(skills.status, 'active')))
    .orderBy(desc(sql`coalesce(${skills.lastUsedAt}, ${skills.updatedAt})`))
    .limit(SKILL_LIST_LIMIT)
}

/**
 * The body of an active skill, counting one use.
 *
 * @returns The body, or undefined when the agent has no active skill of that name.
 *
 * @remarks
 * Only the agent itself updates its counters, and they never change `revision`; a use counted
 * twice at the same moment may be lost.
 */
export async function useSkill(
  db: MemoryDb,
  agentId: string,
  name: string,
  now: number,
): Promise<string | undefined> {
  const skill = await readSkill(db, agentId, name)
  if (skill?.status !== 'active') return undefined
  await db
    .update(skills)
    .set({ useCount: skill.useCount + 1, lastUsedAt: now })
    .where(and(eq(skills.agentId, agentId), eq(skills.name, name)))
  return skill.body
}

/** A skill to create or overwrite. */
export interface SkillWrite {
  agentId: string
  name: string
  description: string
  body: string
  evidence: string
  /** The revision the writer read; omitted to create the skill. */
  revision?: number
}

/** Rules a skill must follow before it is stored. */
function checkedSkill(write: SkillWrite): SkillWrite {
  if (!isSkillName(write.name)) throw new TypeError(`Invalid skill name: ${write.name}`)
  const description = write.description.trim()
  const body = write.body.trim()
  if (description.length === 0 || description.length > MAX_SKILL_DESCRIPTION) {
    throw new TypeError(`A skill description has 1–${MAX_SKILL_DESCRIPTION} characters`)
  }
  if (body.length === 0 || body.length > MAX_SKILL_BODY) {
    throw new TypeError(`A skill body has 1–${MAX_SKILL_BODY} characters`)
  }
  return { ...write, description, body }
}

/**
 * Create a skill, or overwrite it at the revision the writer read, as one operation.
 *
 * @returns `conflict` when the skill changed since it was read, or is missing; a repeat of the same
 * operation returns the first result.
 * @throws {@link TypeError} When the name, description, or body breaks its limits.
 *
 * @remarks
 * The ledger keeps the previous body, so an earlier version can be restored by writing it again.
 */
export function writeSkill(
  db: MemoryDb,
  context: OperationContext,
  input: SkillWrite,
): Promise<OperationResult & { replayed: boolean }> {
  const write = checkedSkill(input)
  const key = skillKey(write.agentId, write.name)
  return applyPlan(db, context, async (): Promise<Plan> => {
    const current = await readSkill(db, write.agentId, write.name)
    if ((current?.revision ?? undefined) !== write.revision) {
      return conflict(db, context, key, current === undefined ? 'no_skill' : 'target_changed')
    }
    const result: OperationResult = { status: 'applied', recordId: key }
    const fields = {
      description: write.description,
      body: write.body,
      evidence: write.evidence,
      status: 'active' as const,
      updatedAt: context.now,
    }
    const change =
      current === undefined
        ? db
            .insert(skills)
            .values({ agentId: write.agentId, name: write.name, ...fields, createdAt: context.now })
        : db
            .update(skills)
            .set({ ...fields, revision: current.revision + 1 })
            .where(
              and(
                eq(skills.agentId, write.agentId),
                eq(skills.name, write.name),
                eq(skills.revision, current.revision),
              ),
            )
    const statements: Statements = [
      insertOp(db, context, 'skill_write', result),
      change,
      claimRevision(db, context, 'skill', key, (current?.revision ?? 0) + 1),
      recordLedger(db, context, 'skill_write', key, { before: current?.body ?? null }, 'skill'),
      bumpScope(db, context, agentScope(write.agentId)),
    ]
    return { result, statements }
  })
}

/**
 * Archive a skill, or restore an archived one, at the revision the writer read.
 *
 * @returns `conflict` when the skill changed since it was read.
 */
export function setSkillStatus(
  db: MemoryDb,
  context: OperationContext,
  target: { agentId: string; name: string; revision: number; status: SkillStatus },
): Promise<OperationResult & { replayed: boolean }> {
  const key = skillKey(target.agentId, target.name)
  return applyPlan(db, context, async (): Promise<Plan> => {
    const current = await readSkill(db, target.agentId, target.name)
    if (current === undefined || current.revision !== target.revision) {
      return conflict(db, context, key, 'target_changed')
    }
    const result: OperationResult = { status: 'applied', recordId: key }
    const statements: Statements = [
      insertOp(db, context, `skill_${target.status}`, result),
      db
        .update(skills)
        .set({ status: target.status, revision: current.revision + 1, updatedAt: context.now })
        .where(
          and(
            eq(skills.agentId, target.agentId),
            eq(skills.name, target.name),
            eq(skills.revision, current.revision),
          ),
        ),
      claimRevision(db, context, 'skill', key, current.revision + 1),
      recordLedger(db, context, `skill_${target.status}`, key, {}, 'skill'),
      bumpScope(db, context, agentScope(target.agentId)),
    ]
    return { result, statements }
  })
}

/**
 * Archive active skills neither used nor written for {@link SKILL_ARCHIVE_DAYS}; they can be
 * restored.
 *
 * @returns How many were archived in this call, at most 200.
 */
export async function curateSkills(db: MemoryDb, runId: string, now: number): Promise<number> {
  const before = now - SKILL_ARCHIVE_DAYS * DAY_MS
  const rows = await db
    .select()
    .from(skills)
    .where(
      and(
        eq(skills.status, 'active'),
        lt(skills.updatedAt, before),
        or(isNull(skills.lastUsedAt), lt(skills.lastUsedAt, before)),
      ),
    )
    .limit(CURATE_BATCH)
  for (const skill of rows) {
    await setSkillStatus(
      db,
      {
        opId: `curate:${skillKey(skill.agentId, skill.name)}@${skill.revision}`,
        jobId: runId,
        runId,
        actor: 'consolidation',
        now,
      },
      { agentId: skill.agentId, name: skill.name, revision: skill.revision, status: 'archived' },
    )
  }
  return rows.length
}
