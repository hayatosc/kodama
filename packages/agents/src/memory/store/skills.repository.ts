/**
 * Data-access repository for memory skills in memory D1.
 *
 * @see docs/memory.md — Skills
 *
 * @module
 */
import { parseEnum, prepareQuery } from '../../lib/reylo.ts'
import type { VisibleSkill } from '../skills.ts'
import type { MemoryDb } from './db.ts'
import { queries } from './queries/index.ts'

/** Only `active` skills are listed; `archived` ones can be restored. */
export const SKILL_STATUSES = ['active', 'archived'] as const
/** Whether a skill is listed (`active`) or put away (`archived`). */
export type SkillStatus = (typeof SKILL_STATUSES)[number]

/** A skill row. */
export interface Skill {
  agentId: string
  name: string
  description: string
  body: string
  status: SkillStatus
  evidence: string
  revision: number
  useCount: number
  lastUsedAt: number | null
  createdAt: number
  updatedAt: number
}

function parseSkill(row: {
  agentId: string
  name: string
  description: string
  body: string
  status: string
  evidence: string
  revision: number
  useCount: number
  lastUsedAt: number | null
  createdAt: number
  updatedAt: number
}): Skill {
  return {
    ...row,
    status: parseEnum(SKILL_STATUSES, row.status, 'skill status'),
  }
}

/** A skill of an agent, in any status. */
export async function readSkill(
  db: MemoryDb,
  agentId: string,
  name: string,
): Promise<Skill | undefined> {
  const row = await queries.getSkill.run(db, { agentId, name })
  return row === null ? undefined : parseSkill(row)
}

/** An agent's skills in any status, by name. */
export async function listSkills(db: MemoryDb, agentId: string): Promise<Skill[]> {
  const rows = await queries.listSkills.run(db, { agentId })
  return rows.map(parseSkill)
}

/** Fetch up to `limit` recently used active skills for an agent. */
export async function listVisibleSkillRows(
  db: MemoryDb,
  agentId: string,
  limit: number,
): Promise<VisibleSkill[]> {
  return queries.listVisibleSkills.run(db, { agentId, limit })
}

/** Increment a skill's use counter and record its last-used timestamp. */
export async function incrementSkillUse(
  db: MemoryDb,
  params: { agentId: string; name: string; nextUseCount: number; lastUsedAt: number },
): Promise<void> {
  await queries.updateIncrementSkillUse.run(db, params)
}

/** Prepare a statement inserting a new skill row. */
export function insertSkillStatement(
  db: MemoryDb,
  params: {
    agentId: string
    name: string
    description: string
    body: string
    status: SkillStatus
    evidence: string
    createdAt: number
    updatedAt: number
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.insertSkill, params)
}

/** Prepare a revision-guarded statement updating a skill row. */
export function updateSkillStatement(
  db: MemoryDb,
  params: {
    agentId: string
    name: string
    description: string
    body: string
    evidence: string
    status: SkillStatus
    updatedAt: number
    nextRevision: number
    revision: number
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.updateSkill, params)
}

/** Prepare a revision-guarded statement changing a skill's active/archived status. */
export function updateSkillStatusStatement(
  db: MemoryDb,
  params: {
    agentId: string
    name: string
    status: SkillStatus
    nextRevision: number
    revision: number
    updatedAt: number
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.updateSkillStatus, params)
}

/** List stale active skills unused since before `before`, bounded by `limit`. */
export async function listStaleSkills(
  db: MemoryDb,
  before: number,
  limit: number,
): Promise<Skill[]> {
  return (await queries.listStaleSkills.run(db, { before, limit })).map(parseSkill)
}
