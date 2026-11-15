/**
 * The always-loaded memory of a working agent: the records and skills put into its prompt, cached in
 * the object's SQLite and refreshed when a scope revision changes.
 *
 * @see docs/memory.md — Always-loaded memory
 *
 * @module
 */
import * as v from 'valibot'
import { visibleSkills } from '../store/skills.ts'
import { visibleTasks } from '../store/tasks.ts'
import { memoryRevisions, promptRecords } from '../store/queries.ts'
import {
  markMemoryChecked,
  saveLocalTasks,
  saveMemoryCopy,
  storedMemoryCopy,
} from '../../agent/local-db/memory.ts'
import type { VisibleSkill } from '../skills.ts'
import type { VisibleTask } from '../tasks.ts'
import { memoryDb, agentScope, readableScopes } from '../store/db.ts'
import type { MemoryRecord } from '../store/db.ts'
import type { WorkingMemoryDeps } from './deps.ts'

/** Characters of the agent's own standing instructions in the prompt. */
export const AGENT_INSTRUCTION_BUDGET = 1_200
/** Characters of the agent's own facts/notes in the prompt. */
export const AGENT_FACT_BUDGET = 1_500
/** Characters of shared records in the prompt. */
export const SHARED_MEMORY_BUDGET = 1_000
/** How often a working agent checks D1 for changed scope revisions. */
export const REVISION_CHECK_INTERVAL_MS = 60_000

type Revisions = Record<string, number>

/**
 * The most lines a block of `budget` characters can hold: each takes at least four, `- `, one
 * character, and its newline. A row past this many adds a line only when a longer row ahead of it
 * was skipped, which the bound gives up for a read that stays small.
 */
function maxLines(budget: number): number {
  return Math.floor(budget / 4)
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

function blockText(label: string, lines: readonly string[]): string | undefined {
  if (lines.length === 0) return undefined
  return [label, ...lines].join('\n')
}

/**
 * Active instructions and facts of the agent and its shared spaces, with overrides applied: an
 * agent record replaces the shared record it overrides, unless that one is required.
 *
 * @remarks
 * Instructions and facts are budgeted separately so high-importance facts cannot evict standing
 * instructions. Section headers stay static for prompt cache stability.
 */
export async function renderAlwaysLoaded(
  db: ReturnType<typeof memoryDb>,
  agentId: string,
  sharedSpaces: readonly string[],
): Promise<{
  text: string
  revisions: Revisions
  skills: VisibleSkill[]
  tasks: VisibleTask[]
}> {
  const own = agentScope(agentId)
  const scopes = readableScopes(agentId, sharedSpaces)
  // Capture revisions first: a write during rendering must remain visible to the next check,
  // rather than tagging old content with a newer revision and keeping it indefinitely.
  const revisions = await memoryRevisions(db, scopes)
  const shared = scopes.filter((scope) => scope !== own)
  const agentInstructions = await promptRecords(
    db,
    agentId,
    [own],
    scopes,
    maxLines(AGENT_INSTRUCTION_BUDGET),
    ['instruction'],
  )
  const agentFacts = await promptRecords(db, agentId, [own], scopes, maxLines(AGENT_FACT_BUDGET), [
    'fact',
  ])
  const spaceOrder = (record: MemoryRecord) => scopes.indexOf(record.scope)
  const sharedRecords =
    shared.length === 0
      ? []
      : (await promptRecords(db, agentId, shared, scopes, maxLines(SHARED_MEMORY_BUDGET))).sort(
          (a, b) => spaceOrder(a) - spaceOrder(b),
        )

  const skills = await visibleSkills(db, agentId)
  const tasks = await visibleTasks(db, agentId)
  const blocks = [
    blockText('INSTRUCTIONS', fit(agentInstructions, AGENT_INSTRUCTION_BUDGET)),
    blockText('NOTES', fit(agentFacts, AGENT_FACT_BUDGET)),
    blockText('SHARED', fit(sharedRecords, SHARED_MEMORY_BUDGET)),
  ].filter((block): block is string => block !== undefined)
  if (blocks.length === 0) return { text: '', revisions, skills, tasks }
  const text = [
    'Long-term memory saved in earlier turns. Use memory_search for more, and remember to keep something new.',
    ...blocks,
  ].join('\n')
  return { text, revisions, skills, tasks }
}

function sameRevisions(a: Revisions, b: Revisions): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every((key) => a[key] === b[key])
}

const visibleSkillSchema = v.array(v.object({ name: v.string(), description: v.string() }))
const visibleTaskSchema = v.array(
  v.object({
    slug: v.string(),
    title: v.string(),
    status: v.picklist(['in_progress', 'blocked']),
    summary: v.string(),
  }),
)

function parseSkills(json: string): VisibleSkill[] {
  const parsed = v.safeParse(visibleSkillSchema, JSON.parse(json))
  return parsed.success ? parsed.output : []
}

function parseTasks(json: string): VisibleTask[] {
  const parsed = v.safeParse(visibleTaskSchema, JSON.parse(json))
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

/** The stored always-loaded text, which the `memory` section shows. */
export async function storedMemoryText(memory: WorkingMemoryDeps): Promise<string> {
  return storedMemoryCopy(await memory.local())?.text ?? ''
}

/** The skills listed in the `skills` section, from the same stored copy. */
export async function storedSkills(memory: WorkingMemoryDeps): Promise<VisibleSkill[]> {
  const row = storedMemoryCopy(await memory.local())
  return row === undefined ? [] : parseSkills(row.skillsJson)
}

/** The active task checkpoints listed in the `tasks` section, from the same stored copy. */
export async function storedTasks(memory: WorkingMemoryDeps): Promise<VisibleTask[]> {
  const row = storedMemoryCopy(await memory.local())
  return row === undefined ? [] : parseTasks(row.tasksJson)
}

/** Immediately update the object-local task cache after `task_write`. */
export async function updateLocalTasks(
  memory: WorkingMemoryDeps,
  tasks: readonly VisibleTask[],
): Promise<void> {
  saveLocalTasks(await memory.local(), JSON.stringify(tasks))
}

/** Render the always-loaded memory again from D1 and store the copy. Run only while idle. */
export async function refreshAlwaysLoaded(memory: WorkingMemoryDeps): Promise<void> {
  const { text, revisions, skills, tasks } = await renderAlwaysLoaded(
    memoryDb(memory.env.MEMORY_DB),
    memory.agentId(),
    await memory.sharedSpaces(),
  )
  const row = {
    id: 1,
    text,
    revisionsJson: JSON.stringify(revisions),
    skillsJson: JSON.stringify(skills),
    tasksJson: JSON.stringify(tasks),
    checkedAt: memory.now?.() ?? Date.now(),
  }
  const local = await memory.local()
  saveMemoryCopy(local, row)
}

/**
 * Render again when a scope revision changed since the copy was built. Checks D1 at most once
 * per {@link REVISION_CHECK_INTERVAL_MS}, so a lost change notice delays an update, not loses it.
 */
export async function refreshAlwaysLoadedIfChanged(memory: WorkingMemoryDeps): Promise<void> {
  const local = await memory.local()
  const stored = storedMemoryCopy(local)
  const now = memory.now?.() ?? Date.now()
  if (stored === undefined) return refreshAlwaysLoaded(memory)
  if (now - stored.checkedAt < REVISION_CHECK_INTERVAL_MS) return
  const scopes = readableScopes(memory.agentId(), await memory.sharedSpaces())
  const current = await memoryRevisions(memoryDb(memory.env.MEMORY_DB), scopes)
  if (!sameRevisions(current, parseRevisions(stored.revisionsJson))) {
    return refreshAlwaysLoaded(memory)
  }
  markMemoryChecked(local, now)
}
