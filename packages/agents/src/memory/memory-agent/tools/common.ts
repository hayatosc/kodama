/** What the memory agent's tools share: the running job, schemas, and the writing wrapper. */
import { Type } from '@earendil-works/pi-ai'
import type { Static, TSchema } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'
import type { ToolExecutionApi, ToolRegistration } from '@earendil-works/pi-durable'
import { and, eq } from 'drizzle-orm'
import type { AgentEnv } from '../../../env.ts'
import { looksLikeInjection, redactSecrets } from '../../redact.ts'
import { memoryDb } from '../../store/db.ts'
import type { MemoryDb, MemoryRecord, RecordKind } from '../../store/db.ts'
import { applyOperation } from '../../store/records.ts'
import type { NewRecord, Operation } from '../../store/records.ts'
import { skills } from '../../../../drizzle/d1/schema/skills.ts'
import type { Scope } from '../../../../drizzle/d1/schema/records.ts'
import type { OperationResult } from '../../store/statements.ts'
import type { MemoryJob } from '../jobs.ts'

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

export const KIND = Type.Union([
  Type.Literal('fact'),
  Type.Literal('instruction'),
  Type.Literal('event'),
  Type.Literal('task'),
])
export const CONTENT = Type.String({ minLength: 1, maxLength: 2_000 })
export const IMPORTANCE = Type.Optional(Type.Number({ minimum: 0, maximum: 1 }))
export const OVERRIDES = Type.Optional(
  Type.String({
    minLength: 1,
    description: 'ID of a shared record this agent record replaces for the agent only',
  }),
)
export const ENTRY = Type.Optional(
  Type.Integer({ minimum: 0, description: 'Entry ID; extraction cites its entries' }),
)

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function text(value: string) {
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

export function describe(result: OperationResult & { replayed: boolean }): string {
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
export function jobScope(job: MemoryJob): Scope {
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

export function sourceAgentOf(job: MemoryJob, scope: Scope): string {
  if ('sourceAgentId' in job) return job.sourceAgentId
  return scope.slice(scope.indexOf(':') + 1)
}

export interface RecordArgs {
  kind: RecordKind
  content: string
  importance?: number
  sourceEntryFrom?: number
  sourceEntryTo?: number
  overrides?: string
}

/** Build the record from the job, so origin, scope, and evidence never come from the model. */
export function recordFor(job: MemoryJob, args: RecordArgs, now: number): NewRecord {
  const content = redactSecrets(args.content.trim())
  if (looksLikeInjection(content)) throw new Error('The content looks like an instruction to obey')
  const scope = jobScope(job)
  if (args.overrides !== undefined && !scope.startsWith('agent:')) {
    throw new Error('Only an agent record can override a shared record')
  }
  const base = {
    scope,
    kind: args.kind,
    content,
    sourceAgentId: sourceAgentOf(job, scope),
    importance: args.importance,
    ...(args.overrides === undefined ? {} : { overrides: args.overrides }),
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

export function writingTool<P extends TSchema>(
  deps: MemoryToolDeps,
  definition: {
    name: string
    description: string
    parameters: P
    operation: (args: Static<P>, job: MemoryJob, now: number) => Operation
    /** Side effects that must happen before the operation is recorded; they must be idempotent. */
    prepare?: (args: Static<P>, job: MemoryJob) => Promise<void>
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
      const { job } = running
      if (job.kind === 'consolidate' && job.scope.startsWith('shared:') && op.type !== 'decline') {
        throw new Error('Shared records change only through proposals; use shared_propose')
      }
      await definition.prepare?.(args, running.job)
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
export function searchScopes(job: MemoryJob): Scope[] {
  const own = jobScope(job)
  return own === 'shared:global' ? [own] : [own, 'shared:global']
}

/** The memory database of the tools. */
export function toolDb(deps: MemoryToolDeps): MemoryDb {
  return memoryDb(deps.env.MEMORY_DB)
}

/** The skill row of a scope and name, if any. */
export function skillRow(db: MemoryDb, scope: Scope, name: string) {
  return db
    .select()
    .from(skills)
    .where(and(eq(skills.scope, scope), eq(skills.name, name)))
    .get()
}
