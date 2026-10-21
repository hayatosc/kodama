/** Tools that search and change memory records. */
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'
import type { ToolRegistration } from '@earendil-works/pi-durable'
import type { MemoryDb } from '../../store/db.ts'
import { searchMemory } from '../../store/search.ts'
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
} from './common.ts'
import type { MemoryToolDeps } from './common.ts'

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

  /** The agent scope a consolidate job may change skills in. */

  return [search, write, supersede, invalidate, decline, listRecords]
}
