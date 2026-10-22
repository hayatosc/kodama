/**
 * Tools that search and change memory records, and `shared_write` for shared spaces.
 *
 * @module
 */
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'
import type { ToolRegistration, ToolExecutionApi } from '@earendil-works/pi-durable'
import type { MemoryDb } from '../store/db.ts'
import { searchMemory } from '../store/search.ts'
import { consolidationRecords } from '../consolidation.ts'
import {
  CONTENT,
  ENTRY,
  formatRecords,
  IMPORTANCE,
  KIND,
  OVERRIDES,
  recordFor,
  searchScopes,
  text,
  toolDb,
  writingTool,
  describe,
} from './common.ts'
import type { MemoryToolDeps } from './common.ts'
import { sha256Hex } from '../../lib/hash.ts'
import { MIN_SOURCE_AGENTS, writeShared } from '../shared.ts'

/** The record tools every job gets: search, write, supersede, invalidate, decline, and list. */
export function recordTools(deps: MemoryToolDeps): ToolRegistration[] {
  const db = (): MemoryDb => toolDb(deps)
  const search = defineTool({
    name: 'memory_search',
    description: 'Search active memory records related to the job; returns ids and revisions.',
    parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 500 }) }),
    replay: 'safe',
    execute: async ({ query }) => {
      const running = await deps.runningJob()
      if (running === undefined) throw new Error('No memory job is running')
      const records = await searchMemory(db(), {
        query,
        scopes: searchScopes(running.job),
        now: deps.now?.() ?? Date.now(),
        countUse: false,
      })
      return text(formatRecords(records))
    },
  })

  const recordParameters = Type.Object({
    kind: KIND,
    content: CONTENT,
    importance: IMPORTANCE,
    sourceEntryFrom: ENTRY,
    sourceEntryTo: ENTRY,
    overrides: OVERRIDES,
  })
  const write = writingTool(deps, {
    name: 'memory_write',
    description: 'Write a new record for the job.',
    parameters: recordParameters,
    operation: (args, job, now) => ({ type: 'write', record: recordFor(job, args, now) }),
  })
  const supersede = writingTool(deps, {
    name: 'memory_supersede',
    description: 'Replace an active record, named by id and revision, with an updated one.',
    parameters: Type.Object({
      oldId: Type.String(),
      oldRevision: Type.Integer({ minimum: 1 }),
      kind: KIND,
      content: CONTENT,
      importance: IMPORTANCE,
      sourceEntryFrom: ENTRY,
      sourceEntryTo: ENTRY,
    }),
    operation: (args, job, now) => ({
      type: 'supersede',
      oldId: args.oldId,
      oldRevision: args.oldRevision,
      record: recordFor(job, args, now),
    }),
  })
  const invalidate = writingTool(deps, {
    name: 'memory_invalidate',
    description: 'Mark an active record as no longer true.',
    parameters: Type.Object({
      id: Type.String(),
      revision: Type.Integer({ minimum: 1 }),
      reason: Type.String({ minLength: 1, maxLength: 500 }),
    }),
    operation: (args) => ({
      type: 'invalidate',
      id: args.id,
      revision: args.revision,
      reason: args.reason,
    }),
  })
  const decline = writingTool(deps, {
    name: 'memory_decline',
    description: 'Decline the candidate of the job, with the reason.',
    parameters: Type.Object({ reason: Type.String({ minLength: 1, maxLength: 500 }) }),
    operation: (args, job) => ({
      type: 'decline',
      candidate: job.kind === 'remember' ? job.content : job.kind,
      reason: args.reason,
    }),
  })

  const listRecords = defineTool({
    name: 'list_records',
    description:
      'List the active records of the scope of a consolidate job, by kind and then most used first.',
    parameters: Type.Object({}),
    replay: 'safe',
    execute: async () => {
      const running = await deps.runningJob()
      if (running?.job.kind !== 'consolidate')
        throw new Error('list_records needs a consolidate job')
      const records = await consolidationRecords(db(), running.job.scope)
      const lines = records.map(
        (record) =>
          `- id=${record.id} revision=${record.revision} kind=${record.kind}` +
          ` importance=${record.importance} used=${record.useCount}` +
          ` observed=${new Date(record.observedAt).toISOString().slice(0, 10)}` +
          `${record.pinned ? ' pinned' : ''}${record.required ? ' required' : ''}` +
          `${record.overrides === null ? '' : ` overrides=${record.overrides}`}: ${record.content}`,
      )
      return text(lines.length === 0 ? 'No active records.' : lines.join('\n'))
    },
  })

  return [search, write, supersede, invalidate, decline, listRecords]
}

/**
 * `shared_write`, which writes a shared record only when its sources pass the checks of
 * {@link writeShared}.
 */
export function sharedTools(deps: MemoryToolDeps): ToolRegistration[] {
  return [
    defineTool({
      name: 'shared_write',
      description: `Write a record to a shared space, new or replacing a shared record by id. Code applies it only when the cited sources are active records of at least ${MIN_SOURCE_AGENTS} agents, or only records of that space.`,
      parameters: Type.Object({
        space: Type.String({ pattern: '^[a-z0-9-]{1,64}$' }),
        kind: KIND,
        content: CONTENT,
        importance: IMPORTANCE,
        required: Type.Optional(
          Type.Boolean({ description: 'A team rule agents cannot override' }),
        ),
        replaces: Type.Optional(
          Type.String({ description: 'ID of the shared record it replaces' }),
        ),
        sourceIds: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), {
          minItems: 1,
          maxItems: 20,
        }),
      }),
      replay: 'safe',
      execute: async (args, api: ToolExecutionApi) => {
        const running = await deps.runningJob()
        if (running?.job.kind !== 'consolidate') {
          throw new Error('shared_write needs a consolidate job')
        }
        const result = await writeShared(
          toolDb(deps),
          {
            opId: await sha256Hex(`${running.jobId}:${api.callId}`),
            jobId: running.jobId,
            runId: running.jobId,
            actor: 'memory-agent',
            now: deps.now?.() ?? Date.now(),
          },
          args,
        )
        return text(result.status === 'rejected' ? `rejected: ${result.reason}` : describe(result))
      },
    }),
  ]
}
