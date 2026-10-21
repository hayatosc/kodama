/**
 * Long-term memory as a working agent sees it: the always-loaded section and the memory tools
 * (docs/design/long-term-memory.md, Working agents, Always-loaded memory).
 */
import { Type } from '@earendil-works/pi-ai'
import { defineExtension, defineTool, section } from '@earendil-works/pi-durable'
import type { Extension, ToolRegistration } from '@earendil-works/pi-durable'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { AgentEnv } from '../env.ts'
import { alwaysLoaded, rememberTurns } from '../storage/local-schema.ts'
import type { LocalDb } from '../storage/local.ts'
import { searchHistory } from './archive.ts'
import type { HistoryResult } from './archive.ts'
import { memoryDb, searchMemory } from './records.ts'
import type { MemoryRecord, Scope } from './records.ts'
import { looksLikeInjection, redactSecrets } from './redact.ts'
import { memoryRecords, scopeRevisions } from './schema.ts'

export const MEMORY_AGENT_NAME = 'memory'
export const AGENT_MEMORY_BUDGET = 2_200
export const SHARED_MEMORY_BUDGET = 1_000
export const REVISION_CHECK_INTERVAL_MS = 60_000
export const REMEMBER_LIMIT_PER_TURN = 3

export interface WorkingMemoryDeps {
  env: Pick<AgentEnv, 'MEMORY_DB' | 'MEMORY_AGENT' | 'ARCHIVE'>
  agentId: () => string
  local: () => Promise<LocalDb>
  /** Shared spaces the agent reads, earliest first. */
  sharedSpaces: () => Promise<readonly string[]>
  now?: () => number
}

export function agentScope(agentId: string): Scope {
  return `agent:${agentId}`
}

export function readableScopes(agentId: string, sharedSpaces: readonly string[]): Scope[] {
  return [agentScope(agentId), ...sharedSpaces.map((space): Scope => `shared:${space}`)]
}

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
): Promise<{ text: string; revisions: Revisions }> {
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
      sql`${memoryRecords.lastUsedAt} DESC NULLS LAST`,
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
  if (agentRecords.length === 0 && sharedRecords.length === 0) return { text: '', revisions }
  const text = [
    'Long-term memory saved in earlier turns. Use memory_search for more, and remember to keep something new.',
    blockText('MEMORY', fit(agentRecords, AGENT_MEMORY_BUDGET), AGENT_MEMORY_BUDGET),
    blockText('SHARED', fit(sharedRecords, SHARED_MEMORY_BUDGET), SHARED_MEMORY_BUDGET),
  ].join('\n')
  return { text, revisions }
}

function sameRevisions(a: Revisions, b: Revisions): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every((key) => a[key] === b[key])
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

  /** Render again from D1 and store the copy. */
  async refresh(): Promise<void> {
    const { text, revisions } = await renderAlwaysLoaded(
      memoryDb(this.#deps.env.MEMORY_DB),
      this.#deps.agentId(),
      await this.#deps.sharedSpaces(),
    )
    const row = { id: 1, text, revisionsJson: JSON.stringify(revisions), checkedAt: this.#now() }
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

function memorySearchTool(deps: WorkingMemoryDeps): ToolRegistration {
  return defineTool({
    name: 'memory_search',
    description:
      'Search your long-term memory and the shared memory for facts, instructions, events, and tasks saved earlier.',
    parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 500 }) }),
    replay: 'safe',
    execute: async ({ query }) => {
      const records = await searchMemory(memoryDb(deps.env.MEMORY_DB), {
        query,
        scopes: readableScopes(deps.agentId(), await deps.sharedSpaces()),
        now: deps.now?.() ?? Date.now(),
      })
      const lines =
        records.length === 0
          ? 'No matching memory.'
          : records.map((record) => `- [${record.kind}] ${record.content}`).join('\n')
      return { output: [{ type: 'text', text: lines }] }
    },
  })
}

function formatHistory(result: HistoryResult): string {
  const lines: string[] = []
  for (const summary of result.summaries) {
    lines.push(
      `Summary of ${summary.segmentId} (${new Date(summary.at).toISOString()}):`,
      summary.summary,
    )
  }
  for (const hit of result.hits) {
    lines.push(
      `Entries #${hit.firstEntry}-#${hit.lastEntry} (${new Date(hit.at).toISOString()}):`,
      hit.text,
    )
  }
  if (lines.length === 0) lines.push('No matching archived history.')
  if (!result.complete && result.searchedBefore !== undefined) {
    lines.push(`(older history not searched; pass before=${result.searchedBefore} to continue)`)
  }
  return lines.join('\n')
}

function historySearchTool(deps: WorkingMemoryDeps): ToolRegistration {
  return defineTool({
    name: 'history_search',
    description:
      'Search the archived part of this conversation, older than what you can see, for the exact words used. Results are newest first.',
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 500 }),
      before: Type.Optional(
        Type.Integer({ minimum: 0, description: 'Only search history older than this time (ms)' }),
      ),
    }),
    replay: 'safe',
    execute: async ({ query, before }) => {
      const result = await searchHistory(
        memoryDb(deps.env.MEMORY_DB),
        deps.env.ARCHIVE,
        deps.agentId(),
        query,
        before === undefined ? {} : { before },
      )
      return { output: [{ type: 'text', text: formatHistory(result) }] }
    },
  })
}

function rememberTool(deps: WorkingMemoryDeps): ToolRegistration {
  return defineTool({
    name: 'remember',
    description:
      'Keep something in long-term memory: a standing instruction or something the user asked you to remember (origin user_request), or a decision with its reason, a correction, a lesson from a failure, or a durable fact you had to look up (origin agent_judgment). Not for task progress, guesses, secrets, or one-off requests.',
    parameters: Type.Object({
      content: Type.String({ minLength: 1, maxLength: 2_000 }),
      origin: Type.Union([Type.Literal('user_request'), Type.Literal('agent_judgment')]),
    }),
    replay: 'safe',
    execute: async ({ content, origin }, api, context) => {
      const cleaned = redactSecrets(content.trim())
      if (looksLikeInjection(cleaned)) {
        throw new Error('Not saved: the content reads as instructions to whoever reads it later')
      }
      const userEntry = await api.commit(async (tx) => {
        const page = await tx.scanEntries(
          { conversationId: api.conversationId, order: 'descending' },
          64,
        )
        return page.items.find((entry) => entry.kind === 'pi.user')?.id
      }, context)
      if (userEntry === undefined) throw new Error('Not saved: no user message to attribute it to')

      const local = await deps.local()
      const turn = local
        .select()
        .from(rememberTurns)
        .where(eq(rememberTurns.entryId, userEntry))
        .get()
      if ((turn?.count ?? 0) >= REMEMBER_LIMIT_PER_TURN) {
        throw new Error(`Not saved: at most ${REMEMBER_LIMIT_PER_TURN} memories per turn`)
      }
      local
        .insert(rememberTurns)
        .values({ entryId: userEntry, count: 1 })
        .onConflictDoUpdate({
          target: rememberTurns.entryId,
          set: { count: sql`${rememberTurns.count} + 1` },
        })
        .run()

      const status = await deps.env.MEMORY_AGENT.getByName(MEMORY_AGENT_NAME).enqueue({
        kind: 'remember',
        sourceAgentId: deps.agentId(),
        origin,
        content: cleaned,
        sourceEntries: { from: userEntry, to: userEntry },
      })
      return {
        output: [{ type: 'text', text: `accepted (job ${status.jobId})` }],
        details: { jobId: status.jobId },
      }
    },
  })
}

/** Tools and the always-loaded section every working agent gets, whatever its tool choice. */
export function createWorkingMemoryExtension(
  deps: WorkingMemoryDeps,
  memory: AlwaysLoadedMemory,
): Extension {
  return defineExtension({
    name: 'kodama-memory',
    tools: [memorySearchTool(deps), rememberTool(deps), historySearchTool(deps)],
    sections: [
      section('memory', async () => {
        const text = await memory.text()
        return text.length === 0 ? undefined : text
      }),
    ],
  })
}
