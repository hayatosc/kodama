/**
 * The memory tools every working agent gets.
 *
 * @see docs/memory.md — Working agents
 *
 * @module
 */
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'
import type { Harness, ToolRegistration } from '@earendil-works/pi-durable'
import { currentRunInputs, operatorInput } from '../../agent/runtime/inputs.ts'
import { searchHistory } from '../../memory/archive/history.ts'
import type { HistoryResult } from '../../memory/archive/history.ts'
import { isSkillName } from '../../memory/skills.ts'
import { useSkill } from '../../memory/store/skills.ts'
import { isTaskSlug } from '../../memory/tasks.ts'
import {
  listTaskProgress,
  readTaskProgress,
  visibleTasks,
  writeTaskProgress,
} from '../../memory/store/tasks.ts'
import { updateLocalTasks } from '../../memory/working/always-loaded.ts'
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
  harness: () => Promise<Harness>,
): ToolRegistration {
  return defineTool({
    name: 'remember',
    description:
      'Keep durable facts, standing instructions, decisions with reasons, corrections, or lessons learned in long-term memory. Use task_write for active multi-step task progress; never store guesses, secrets, or one-off requests.',
    parameters: Type.Object({
      content: Type.String({ minLength: 1, maxLength: 2_000 }),
    }),
    replay: 'safe',
    execute: async ({ content }, _api, context) => {
      const inputs = await currentRunInputs(await harness(), context)
      if (!inputs) throw new Error('Remember requires an active execution')
      // Prefer the latest operator input as the quota/evidence anchor so mixed turns keep operator context.
      const anchor = inputs.findLast((entry) => operatorInput(entry) !== undefined) ?? inputs.at(-1)
      const status = await requestRemember(deps, anchor?.id, content)
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

/** `task_write`: creates or updates a durable task progress checkpoint across session resets. */
export function taskWriteTool(
  deps: WorkingMemoryDeps,
  harness: () => Promise<Harness>,
): ToolRegistration {
  return defineTool({
    name: 'task_write',
    description:
      'Create or update a durable task progress checkpoint (notes, checklist, blockers, completion) so work survives session resets.',
    parameters: Type.Object({
      slug: Type.String({
        minLength: 1,
        maxLength: 64,
        description: 'Lowercase slug (a-z, 0-9, hyphens) identifying the task',
      }),
      title: Type.String({ minLength: 1, maxLength: 128 }),
      status: Type.Union([
        Type.Literal('in_progress'),
        Type.Literal('blocked'),
        Type.Literal('completed'),
      ]),
      summary: Type.String({
        minLength: 1,
        maxLength: 280,
        description: 'One-line current state shown in the always-loaded task index',
      }),
      body: Type.String({
        minLength: 1,
        maxLength: 16_000,
        description: 'Full progress notes, next steps, and blockers',
      }),
      revision: Type.Optional(Type.Integer({ minimum: 1 })),
    }),
    replay: 'safe',
    execute: async ({ slug, title, status, summary, body, revision }, api, context) => {
      const db = memoryDb(deps.env.MEMORY_DB)
      const inputs = await currentRunInputs(await harness(), context)
      const now = deps.now?.() ?? Date.now()
      const taskId = String(api.taskId)
      const result = await writeTaskProgress(
        db,
        {
          opId: `task:${deps.agentId()}:${slug}:${taskId}`,
          jobId: taskId,
          runId: String(inputs?.at(-1)?.id ?? taskId),
          actor: deps.agentId(),
          now,
        },
        {
          agentId: deps.agentId(),
          slug,
          title,
          status,
          summary,
          body,
          ...(revision === undefined ? {} : { revision }),
        },
      )
      if (result.status !== 'applied') {
        return { output: [{ type: 'text', text: JSON.stringify(result) }] }
      }
      const syncLocalTasks = async () => {
        await updateLocalTasks(deps, await visibleTasks(db, deps.agentId()))
      }
      await (deps.serialize ? deps.serialize(syncLocalTasks) : syncLocalTasks())
      return { output: [{ type: 'text', text: JSON.stringify(result) }] }
    },
  })
}

/** `task_read`: reads full details of one task checkpoint, or lists non-archived checkpoints. */
export function taskReadTool(deps: WorkingMemoryDeps): ToolRegistration {
  return defineTool({
    name: 'task_read',
    description:
      'Read full notes of one task checkpoint by slug, or omit slug to list active and completed tasks.',
    parameters: Type.Object({
      slug: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    }),
    replay: 'safe',
    execute: async ({ slug }) => {
      const db = memoryDb(deps.env.MEMORY_DB)
      if (slug !== undefined) {
        const row = isTaskSlug(slug) ? await readTaskProgress(db, deps.agentId(), slug) : undefined
        if (!row) throw new Error(`No task checkpoint named ${slug}`)
        return {
          output: [
            {
              type: 'text',
              text: JSON.stringify({
                slug: row.slug,
                title: row.title,
                status: row.status,
                revision: row.revision,
                summary: row.summary,
                body: row.body,
                updatedAt: row.updatedAt,
              }),
            },
          ],
        }
      }
      const rows = await listTaskProgress(db, deps.agentId())
      const text =
        rows.length === 0
          ? 'No task checkpoints.'
          : rows
              .map(
                (row) =>
                  `- [${row.status}] ${row.slug} (rev ${row.revision}): ${row.title} — ${row.summary}`,
              )
              .join('\n')
      return { output: [{ type: 'text', text }] }
    },
  })
}
