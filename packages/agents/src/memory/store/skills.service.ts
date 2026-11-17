/**
 * Skills service: procedures the memory agent writes for one agent, one D1 row each with its body,
 * so a write is one batch that either happens or does not.
 *
 * @see docs/memory.md — Skills
 *
 * @module
 */
import { checkedSkill, SKILL_ARCHIVE_DAYS, SKILL_LIST_LIMIT } from '../skills.ts'
import type { SkillWrite, VisibleSkill } from '../skills.ts'
import { agentScope } from './db.ts'
import type { MemoryDb } from './db.ts'
import { applyPlan } from './records.service.ts'
import {
  incrementSkillUse,
  insertSkillStatement,
  listSkills,
  listStaleSkills,
  listVisibleSkillRows,
  readSkill,
  SKILL_STATUSES,
  updateSkillStatement,
  updateSkillStatusStatement,
} from './skills.repository.ts'
import type { Skill, SkillStatus } from './skills.repository.ts'
import {
  bumpScope,
  claimRevision,
  conflict,
  insertOp,
  recordLedger,
} from './statements.repository.ts'
import type {
  OperationContext,
  OperationResult,
  Plan,
  Statements,
} from './statements.repository.ts'

export { listSkills, readSkill, SKILL_STATUSES }
export type { Skill, SkillStatus }

/** Skills archived per consolidation, to keep the step small. */
const CURATE_BATCH = 200
const DAY_MS = 24 * 60 * 60 * 1000

function skillKey(agentId: string, name: string): string {
  return `${agentId}/${name}`
}

/**
 * The active skills an agent sees: selects up to `SKILL_LIST_LIMIT` most recently used or written
 * skills, then sorts them deterministically by name so usage timestamps do not churn prompt cache.
 */
export async function visibleSkills(db: MemoryDb, agentId: string): Promise<VisibleSkill[]> {
  const rows = await listVisibleSkillRows(db, agentId, SKILL_LIST_LIMIT)
  return rows.sort((a, b) => a.name.localeCompare(b.name))
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
  await incrementSkillUse(db, {
    agentId,
    name,
    nextUseCount: skill.useCount + 1,
    lastUsedAt: now,
  })
  return skill.body
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
    const change =
      current === undefined
        ? insertSkillStatement(db, {
            agentId: write.agentId,
            name: write.name,
            description: write.description,
            body: write.body,
            status: 'active',
            evidence: write.evidence,
            createdAt: context.now,
            updatedAt: context.now,
          })
        : updateSkillStatement(db, {
            agentId: write.agentId,
            name: write.name,
            description: write.description,
            body: write.body,
            evidence: write.evidence,
            status: 'active',
            updatedAt: context.now,
            nextRevision: current.revision + 1,
            revision: current.revision,
          })
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
      updateSkillStatusStatement(db, {
        agentId: target.agentId,
        name: target.name,
        status: target.status,
        nextRevision: current.revision + 1,
        revision: current.revision,
        updatedAt: context.now,
      }),
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
  const rows = await listStaleSkills(db, before, CURATE_BATCH)
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
