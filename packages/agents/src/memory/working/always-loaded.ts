/** The always-loaded memory of a working agent (docs/memory.md, Always-loaded memory). */
import * as v from 'valibot'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { alwaysLoaded } from '../../../drizzle/durable-object/schema.ts'
import { visibleSkills } from '../skills.ts'
import type { VisibleSkill } from '../skills.ts'
import { memoryDb, agentScope, readableScopes } from '../store/db.ts'
import type { MemoryRecord } from '../store/db.ts'
import { memoryRecords, scopeRevisions } from '../../../drizzle/d1/schema.ts'
import type { LocalDb } from '../../storage/local.ts'
import type { WorkingMemoryDeps } from './deps.ts'

export const AGENT_MEMORY_BUDGET = 2_200
export const SHARED_MEMORY_BUDGET = 1_000
export const REVISION_CHECK_INTERVAL_MS = 60_000

type Revisions = Record<string, number>

function budgetLine(label: string, used: number, budget: number): string {
  const percent = Math.round((used / budget) * 100)
  const format = (value: number) => value.toLocaleString('en-US')
  return `${label} [${percent}% — ${format(used)}/${format(budget)} chars]`
}

/** Lines of `records` that fit `budget` characters, in order. */
function fit(records: readonly MemoryRecord[], budget: number): string[] {
  const lines: string[] = []
  let used = 0
  for (const record of records) {
    const line = `- ${record.content}`
    if (used + line.length + 1 > budget) continue
    lines.push(line)
    used += line.length + 1
  }
  return lines
}

function blockText(label: string, lines: readonly string[], budget: number): string {
  const used = lines.reduce((sum, line) => sum + line.length + 1, 0)
  return [budgetLine(label, used, budget), ...lines].join('\n')
}

/**
 * Active instructions and facts of the agent and its shared spaces, with overrides applied: an
 * agent record replaces the shared record it overrides, unless that one is required.
 */
export async function renderAlwaysLoaded(
  db: ReturnType<typeof memoryDb>,
  agentId: string,
  sharedSpaces: readonly string[],
): Promise<{ text: string; revisions: Revisions; skills: VisibleSkill[] }> {
  const own = agentScope(agentId)
  const scopes = readableScopes(agentId, sharedSpaces)
  const records = await db
    .select()
    .from(memoryRecords)
    .where(
      and(
        inArray(memoryRecords.scope, scopes),
        eq(memoryRecords.status, 'active'),
        inArray(memoryRecords.kind, ['fact', 'instruction']),
      ),
    )
    .orderBy(
      desc(memoryRecords.pinned),
      desc(memoryRecords.importance),
      // SQLite orders NULL first ascending, so never-used records come last descending.
      desc(memoryRecords.lastUsedAt),
    )
  const shared = records.filter((record) => record.scope !== own)
  const sharedById = new Map(shared.map((record) => [record.id, record]))
  const agentRecords = records.filter((record) => {
    if (record.scope !== own) return false
    const target = record.overrides === null ? undefined : sharedById.get(record.overrides)
    return target?.required !== true
  })
  const overridden = new Set(agentRecords.map((record) => record.overrides))
  const spaceOrder = (record: MemoryRecord) => scopes.indexOf(record.scope)
  const sharedRecords = shared
    .filter((record) => record.required || !overridden.has(record.id))
    .sort((a, b) => spaceOrder(a) - spaceOrder(b))

  const revisionRows = await db
    .select()
    .from(scopeRevisions)
    .where(inArray(scopeRevisions.scope, scopes))
  const revisions = Object.fromEntries(revisionRows.map((row) => [row.scope, row.revision]))
  const skills = await visibleSkills(db, agentId)
  if (agentRecords.length === 0 && sharedRecords.length === 0)
    return { text: '', revisions, skills }
  const text = [
    'Long-term memory saved in earlier turns. Use memory_search for more, and remember to keep something new.',
    blockText('MEMORY', fit(agentRecords, AGENT_MEMORY_BUDGET), AGENT_MEMORY_BUDGET),
    blockText('SHARED', fit(sharedRecords, SHARED_MEMORY_BUDGET), SHARED_MEMORY_BUDGET),
  ].join('\n')
  return { text, revisions, skills }
}

function sameRevisions(a: Revisions, b: Revisions): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every((key) => a[key] === b[key])
}

const visibleSkillSchema = v.array(v.object({ name: v.string(), description: v.string() }))

function parseSkills(json: string): VisibleSkill[] {
  const parsed = v.safeParse(visibleSkillSchema, JSON.parse(json))
  return parsed.success ? parsed.output : []
}

function parseRevisions(json: string): Revisions {
  const parsed: unknown = JSON.parse(json)
  if (typeof parsed !== 'object' || parsed === null) return {}
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number',
    ),
  )
}

function storedCopy(local: LocalDb) {
  return local.select().from(alwaysLoaded).where(eq(alwaysLoaded.id, 1)).get()
}

/** The stored always-loaded text, which the `memory` section shows. */
export async function storedMemoryText(memory: WorkingMemoryDeps): Promise<string> {
  return storedCopy(await memory.local())?.text ?? ''
}

/** The skills listed in the `skills` section, from the same stored copy. */
export async function storedSkills(memory: WorkingMemoryDeps): Promise<VisibleSkill[]> {
  const row = storedCopy(await memory.local())
  return row === undefined ? [] : parseSkills(row.skillsJson)
}

/** Render the always-loaded memory again from D1 and store the copy. Run only while idle. */
export async function refreshAlwaysLoaded(memory: WorkingMemoryDeps): Promise<void> {
  const { text, revisions, skills } = await renderAlwaysLoaded(
    memoryDb(memory.env.MEMORY_DB),
    memory.agentId(),
    await memory.sharedSpaces(),
  )
  const row = {
    id: 1,
    text,
    revisionsJson: JSON.stringify(revisions),
    skillsJson: JSON.stringify(skills),
    checkedAt: memory.now?.() ?? Date.now(),
  }
  const local = await memory.local()
  local
    .insert(alwaysLoaded)
    .values(row)
    .onConflictDoUpdate({ target: alwaysLoaded.id, set: row })
    .run()
}

/**
 * Render again when a scope revision changed since the copy was built. Checks D1 at most once
 * per `REVISION_CHECK_INTERVAL_MS`, so a lost change notice delays an update, not loses it.
 */
export async function refreshAlwaysLoadedIfChanged(memory: WorkingMemoryDeps): Promise<void> {
  const local = await memory.local()
  const stored = storedCopy(local)
  const now = memory.now?.() ?? Date.now()
  if (stored === undefined) return refreshAlwaysLoaded(memory)
  if (now - stored.checkedAt < REVISION_CHECK_INTERVAL_MS) return
  const scopes = readableScopes(memory.agentId(), await memory.sharedSpaces())
  const rows = await memoryDb(memory.env.MEMORY_DB)
    .select()
    .from(scopeRevisions)
    .where(inArray(scopeRevisions.scope, scopes))
  const current = Object.fromEntries(rows.map((row) => [row.scope, row.revision]))
  if (!sameRevisions(current, parseRevisions(stored.revisionsJson))) {
    return refreshAlwaysLoaded(memory)
  }
  local.update(alwaysLoaded).set({ checkedAt: now }).where(eq(alwaysLoaded.id, 1)).run()
}
