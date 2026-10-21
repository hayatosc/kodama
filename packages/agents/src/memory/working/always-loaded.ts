/** The always-loaded memory of a working agent (docs/memory.md, Always-loaded memory). */
import { and, desc, eq, inArray } from 'drizzle-orm'
import * as v from 'valibot'
import { alwaysLoaded } from '../../../drizzle/durable-object/schema.ts'
import { visibleSkills } from '../skills/usage.ts'
import type { VisibleSkill } from '../skills/paths.ts'
import { memoryDb } from '../store/db.ts'
import type { MemoryRecord } from '../store/db.ts'
import { memoryRecords, scopeRevisions } from '../../../drizzle/d1/schema/records.ts'
import type { Scope } from '../../../drizzle/d1/schema/records.ts'
import { agentScope, isScope, readableScopes } from '../store/scopes.ts'
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
  const skills = await visibleSkills(db, agentId, sharedSpaces)
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

const visibleSkillSchema = v.array(
  v.object({
    scope: v.custom<Scope>((value) => typeof value === 'string' && isScope(value)),
    name: v.string(),
    description: v.string(),
  }),
)

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

/** The stored copy of the always-loaded memory. Refresh only while the agent is idle. */
export class AlwaysLoadedMemory {
  readonly #deps: WorkingMemoryDeps

  constructor(deps: WorkingMemoryDeps) {
    this.#deps = deps
  }

  #now(): number {
    return this.#deps.now?.() ?? Date.now()
  }

  async text(): Promise<string> {
    const local = await this.#deps.local()
    return local.select().from(alwaysLoaded).where(eq(alwaysLoaded.id, 1)).get()?.text ?? ''
  }

  /** The skills listed in the `skills` section, from the same stored copy. */
  async skills(): Promise<VisibleSkill[]> {
    const local = await this.#deps.local()
    const row = local.select().from(alwaysLoaded).where(eq(alwaysLoaded.id, 1)).get()
    return row === undefined ? [] : parseSkills(row.skillsJson)
  }

  /** Render again from D1 and store the copy. */
  async refresh(): Promise<void> {
    const { text, revisions, skills } = await renderAlwaysLoaded(
      memoryDb(this.#deps.env.MEMORY_DB),
      this.#deps.agentId(),
      await this.#deps.sharedSpaces(),
    )
    const row = {
      id: 1,
      text,
      revisionsJson: JSON.stringify(revisions),
      skillsJson: JSON.stringify(skills),
      checkedAt: this.#now(),
    }
    const local = await this.#deps.local()
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
  async refreshIfChanged(): Promise<void> {
    const local = await this.#deps.local()
    const stored = local.select().from(alwaysLoaded).where(eq(alwaysLoaded.id, 1)).get()
    const now = this.#now()
    if (stored === undefined) return this.refresh()
    if (now - stored.checkedAt < REVISION_CHECK_INTERVAL_MS) return
    const scopes = readableScopes(this.#deps.agentId(), await this.#deps.sharedSpaces())
    const rows = await memoryDb(this.#deps.env.MEMORY_DB)
      .select()
      .from(scopeRevisions)
      .where(inArray(scopeRevisions.scope, scopes))
    const current = Object.fromEntries(rows.map((row) => [row.scope, row.revision]))
    if (!sameRevisions(current, parseRevisions(stored.revisionsJson))) return this.refresh()
    local.update(alwaysLoaded).set({ checkedAt: now }).where(eq(alwaysLoaded.id, 1)).run()
  }
}
