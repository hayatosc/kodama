/** The memory tools every working agent gets (docs/design/long-term-memory.md, Working agents). */
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'
import type { ToolRegistration } from '@earendil-works/pi-durable'
import { eq } from 'drizzle-orm'
import { rememberTurns } from '../../storage/local-schema.ts'
import { searchHistory } from '../archive/history.ts'
import type { HistoryResult } from '../archive/history.ts'
import { MEMORY_AGENT_NAME } from '../memory-agent/jobs.ts'
import { looksLikeInjection, redactSecrets } from '../redact.ts'
import { memoryDb } from '../store/db.ts'
import { readableScopes } from '../store/scopes.ts'
import { searchMemory } from '../store/search.ts'
import type { WorkingMemoryDeps } from './deps.ts'

export const REMEMBER_LIMIT_PER_TURN = 3

export function memorySearchTool(deps: WorkingMemoryDeps): ToolRegistration {
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

export function historySearchTool(deps: WorkingMemoryDeps): ToolRegistration {
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

export function rememberTool(deps: WorkingMemoryDeps): ToolRegistration {
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
      // Synchronous object SQLite: nothing runs between the read above and this write.
      const count = (turn?.count ?? 0) + 1
      local
        .insert(rememberTurns)
        .values({ entryId: userEntry, count })
        .onConflictDoUpdate({ target: rememberTurns.entryId, set: { count } })
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
