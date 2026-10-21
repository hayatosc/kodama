/** Tools of the memory agent; working agents never get them. */
import { Type } from '@earendil-works/pi-ai'
import type { Static, TSchema } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'
import type { ToolExecutionApi, ToolRegistration } from '@earendil-works/pi-durable'
import type { AgentEnv } from '../env.ts'
import type { MemoryJob } from './jobs.ts'
import { applyOperation, memoryDb, searchMemory } from './records.ts'
import type {
  MemoryDb,
  MemoryRecord,
  NewRecord,
  Operation,
  OperationResult,
  RecordKind,
  Scope,
} from './records.ts'
import { looksLikeInjection, redactSecrets } from './redact.ts'

export interface RunningJob {
  jobId: string
  job: MemoryJob
}

export interface MemoryToolDeps {
  env: AgentEnv
  /** The job being run; tools refuse to write outside a job. */
  runningJob: () => Promise<RunningJob | undefined>
  now?: () => number
}

const KIND = Type.Union([
  Type.Literal('fact'),
  Type.Literal('instruction'),
  Type.Literal('event'),
  Type.Literal('task'),
])
const CONTENT = Type.String({ minLength: 1, maxLength: 2_000 })
const IMPORTANCE = Type.Optional(Type.Number({ minimum: 0, maximum: 1 }))
const ENTRY = Type.Optional(
  Type.Integer({ minimum: 0, description: 'Entry ID; extraction cites its entries' }),
)

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function text(value: string) {
  return { output: [{ type: 'text' as const, text: value }] }
}

export function formatRecords(records: readonly MemoryRecord[]): string {
  if (records.length === 0) return 'No matching records.'
  return records
    .map(
      (record) =>
        `- id=${record.id} revision=${record.revision} scope=${record.scope} kind=${record.kind}` +
        ` entries<=${record.sourceEntryTo ?? '-'}: ${record.content}`,
    )
    .join('\n')
}

function describe(result: OperationResult & { replayed: boolean }): string {
  switch (result.status) {
    case 'applied':
      return `applied ${result.recordId}`
    case 'declined':
      return 'declined'
    case 'stale':
      return 'stale: the record rests on newer entries; the candidate was declined'
    case 'conflict':
      return `conflict (${result.reason}): search again and retry against the current record`
  }
}

/** The scope a job may write: the source agent's own scope, or the scope it consolidates. */
function jobScope(job: MemoryJob): Scope {
  switch (job.kind) {
    case 'remember':
    case 'extract':
    case 'record_archive':
      return `agent:${job.sourceAgentId}`
    case 'consolidate':
      return job.scope
    case 'apply_proposal':
      throw new Error('apply_proposal jobs run in code')
  }
}

function sourceAgentOf(job: MemoryJob, scope: Scope): string {
  if ('sourceAgentId' in job) return job.sourceAgentId
  return scope.slice(scope.indexOf(':') + 1)
}

interface RecordArgs {
  kind: RecordKind
  content: string
  importance?: number
  sourceEntryFrom?: number
  sourceEntryTo?: number
}

/** Build the record from the job, so origin, scope, and evidence never come from the model. */
function recordFor(job: MemoryJob, args: RecordArgs, now: number): NewRecord {
  const content = redactSecrets(args.content.trim())
  if (looksLikeInjection(content)) throw new Error('The content looks like an instruction to obey')
  const scope = jobScope(job)
  const base = {
    scope,
    kind: args.kind,
    content,
    sourceAgentId: sourceAgentOf(job, scope),
    importance: args.importance,
    observedAt: now,
  }
  switch (job.kind) {
    case 'remember':
      return {
        ...base,
        origin: job.origin,
        importance: args.importance ?? (job.origin === 'user_request' ? 0.7 : 0.4),
        sourceEntries: job.sourceEntries,
      }
    case 'extract': {
      const from = args.sourceEntryFrom
      const to = args.sourceEntryTo ?? from
      if (from === undefined || to === undefined || from <= job.afterEntry || to < from) {
        throw new Error(`Cite the entries after ${job.afterEntry} that support the record`)
      }
      return { ...base, origin: 'extraction', sourceEntries: { from, to } }
    }
    case 'consolidate':
    case 'record_archive':
    case 'apply_proposal':
      return { ...base, origin: 'consolidation' }
  }
}

function writingTool<P extends TSchema>(
  deps: MemoryToolDeps,
  definition: {
    name: string
    description: string
    parameters: P
    operation: (args: Static<P>, job: MemoryJob, now: number) => Operation
  },
): ToolRegistration {
  return defineTool({
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    replay: 'safe',
    execute: async (args, api: ToolExecutionApi) => {
      const running = await deps.runningJob()
      if (running === undefined) throw new Error('No memory job is running')
      const now = deps.now?.() ?? Date.now()
      const op = definition.operation(args, running.job, now)
      const result = await applyOperation(
        memoryDb(deps.env.MEMORY_DB),
        {
          opId: await sha256(`${running.jobId}:${api.callId}`),
          jobId: running.jobId,
          runId: running.jobId,
          actor: 'memory-agent',
          now,
        },
        op,
      )
      return text(describe(result))
    },
  })
}

/** Scopes the memory agent searches for a job: its scope and the global shared space. */
function searchScopes(job: MemoryJob): Scope[] {
  const own = jobScope(job)
  return own === 'shared:global' ? [own] : [own, 'shared:global']
}

export function createMemoryAgentTools(deps: MemoryToolDeps): ToolRegistration[] {
  const db = (): MemoryDb => memoryDb(deps.env.MEMORY_DB)
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

  const readEntries = defineTool({
    name: 'read_entries',
    description: 'Read the source agent entries of an extract job, oldest first.',
    parameters: Type.Object({
      after: Type.Optional(Type.Integer({ minimum: 0, description: 'Read entries after this ID' })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    }),
    replay: 'safe',
    execute: async ({ after, limit }) => {
      const running = await deps.runningJob()
      if (running?.job.kind !== 'extract') throw new Error('read_entries needs an extract job')
      const { job } = running
      const page = await deps.env.AGENTS.getByName(job.sourceAgentId).readEntries({
        after: Math.max(after ?? job.afterEntry, job.afterEntry),
        limit: limit ?? 50,
      })
      const lines = page.entries.map((entry) => `#${entry.id} ${entry.role}: ${entry.text}`)
      lines.push(
        page.end ? `(end of entries, through #${page.through})` : `(more after #${page.through})`,
      )
      return text(lines.join('\n'))
    },
  })
  const finishExtraction = writingTool(deps, {
    name: 'finish_extraction',
    description: 'Record that the extract job has covered entries through lastEntryId.',
    parameters: Type.Object({ lastEntryId: Type.Integer({ minimum: 0 }) }),
    operation: (args, job) => {
      if (job.kind !== 'extract') throw new Error('finish_extraction needs an extract job')
      return {
        type: 'checkpoint',
        agentId: job.sourceAgentId,
        lastEntryId: Math.max(args.lastEntryId, job.afterEntry),
      }
    },
  })

  return [search, write, supersede, invalidate, decline, readEntries, finishExtraction]
}
