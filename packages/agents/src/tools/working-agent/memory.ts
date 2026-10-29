/**
 * The memory tools every working agent gets.
 *
 * @see docs/memory.md — Working agents
 *
 * @module
 */
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'
import type { EntryRecord, ToolRegistration } from '@earendil-works/pi-durable'
import type { Context } from '@earendil-works/chord/context'
import { searchHistory } from '../../memory/archive/history.ts'
import type { HistoryResult } from '../../memory/archive/history.ts'
import { isSkillName } from '../../memory/skills.ts'
import { useSkill } from '../../memory/store/skills.ts'
import { memoryDb, readableScopes } from '../../memory/store/db.ts'
import { searchMemory } from '../../memory/store/search.ts'
import { requestRemember } from '../../memory/working/remember.ts'
import type { WorkingMemoryDeps } from '../../memory/working/deps.ts'

/** `memory_search`: searches the agent's records and its shared spaces. */
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
        forAgent: deps.agentId(),
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
  for (const hit of result.hits) {
    lines.push(
      `Entries #${hit.firstEntry}-#${hit.lastEntry} (${new Date(hit.at).toISOString()}):`,
      hit.text,
    )
  }
  if (lines.length === 0) lines.push('No matching archived history.')
  if (result.nextCursor !== undefined) {
    lines.push(
      `(older history not searched; pass cursor=${result.nextCursor} with the same query to continue)`,
    )
  }
  return lines.join('\n')
}

/** `history_search`: searches the agent's archived conversation. */
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
      cursor: Type.Optional(
        Type.String({
          minLength: 1,
          maxLength: 500,
          description:
            'Continuation from the previous search with the same query; preserves its time bound',
        }),
      ),
    }),
    replay: 'safe',
    execute: async ({ query, before, cursor }) => {
      const result = await searchHistory(
        memoryDb(deps.env.MEMORY_DB),
        deps.env.ARCHIVE,
        deps.agentId(),
        query,
        { before, cursor },
      )
      await deps.contact?.()
      return { output: [{ type: 'text', text: formatHistory(result) }] }
    },
  })
}

/**
 * `remember`: queues a memory agent job to save something worth keeping. The memory agent decides
 * what to write; the tool only records the request.
 */
export function rememberTool(
  deps: WorkingMemoryDeps,
  readInputs: (context: Context) => Promise<readonly EntryRecord[]>,
): ToolRegistration {
  return defineTool({
    name: 'remember',
    description:
      'Keep something in long-term memory: a standing instruction or something the user asked you to remember, a decision with its reason, a correction, a lesson from a failure, or a durable fact you had to look up. Not for task progress, guesses, secrets, or one-off requests.',
    parameters: Type.Object({
      content: Type.String({ minLength: 1, maxLength: 2_000 }),
    }),
    replay: 'safe',
    execute: async ({ content }, _api, context) => {
      const inputs = await readInputs(context)
      // The last input remains the quota/evidence anchor, not a claim of sole execution ownership.
      const status = await requestRemember(deps, inputs.at(-1)?.id, content)
      return {
        output: [{ type: 'text', text: `accepted (job ${status.jobId})` }],
        details: { jobId: status.jobId },
      }
    },
  })
}

/** `skill_read`: returns the body of one of the agent's active skills and counts the use. */
export function skillReadTool(deps: WorkingMemoryDeps): ToolRegistration {
  return defineTool({
    name: 'skill_read',
    description: 'Read one of the skills listed in your skills section, by name.',
    parameters: Type.Object({ name: Type.String({ minLength: 1, maxLength: 64 }) }),
    replay: 'safe',
    execute: async ({ name }) => {
      const body = isSkillName(name)
        ? await useSkill(
            memoryDb(deps.env.MEMORY_DB),
            deps.agentId(),
            name,
            deps.now?.() ?? Date.now(),
          )
        : undefined
      if (body === undefined) throw new Error(`No skill named ${name}`)
      return { output: [{ type: 'text', text: body }] }
    },
  })
}
