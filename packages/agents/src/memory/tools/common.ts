/**
 * What the memory agent's tools share: the running job, argument schemas, and the writing wrapper.
 *
 * @module
 */
import { Type } from '@earendil-works/pi-ai'
import type { Static, TSchema } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'
import type { ToolExecutionApi, ToolRegistration } from '@earendil-works/pi-durable'
import type { AgentEnv } from '../../env.ts'
import { memoryDb } from '../store/db.ts'
import type { MemoryDb, MemoryRecord, RecordKind } from '../store/db.ts'
import { applyOperation } from '../store/records.ts'
import type { NewRecord, Operation, RecordEvidence } from '../store/records.ts'
import type { Scope } from '../../../drizzle/memory/schema.ts'
import type { OperationResult } from '../store/statements.ts'
import type { MemoryJob } from '../jobs.ts'
import { sha256Hex } from '../../lib/hash.ts'

/** The job the memory agent is running, and its ID. */
export interface RunningJob {
  jobId: string
  job: MemoryJob
}

/** What the memory agent's tools need from the agent object. */
export interface MemoryToolDeps {
  env: AgentEnv
  storage: DurableObjectStorage
  /** The job being run; tools refuse to write outside a job. */
  runningJob: () => Promise<RunningJob | undefined>
  now?: () => number
}

/** Durable high-water mark of pages read by the current extraction job. */
export const EXTRACTION_READ_KEY = 'kodama:extraction-read'

/** Read evidence survives eviction, but cannot leak from a different job. */
export async function extractionReadThrough(
  deps: MemoryToolDeps,
  running: RunningJob,
): Promise<number> {
  const progress = await deps.storage.get<{ jobId: string; through: number }>(EXTRACTION_READ_KEY)
  return progress?.jobId === running.jobId
    ? progress.through
    : running.job.kind === 'extract'
      ? running.job.afterEntry
      : 0
}

/** The kind of a record. */
export const KIND = Type.Union([
  Type.Literal('fact'),
  Type.Literal('instruction'),
  Type.Literal('event'),
  Type.Literal('task'),
])
/** The text of a record, 1–2,000 characters. */
export const CONTENT = Type.String({ minLength: 1, maxLength: 2_000 })
/** How much a record matters, from 0 to 1. */
export const IMPORTANCE = Type.Optional(Type.Number({ minimum: 0, maximum: 1 }))
/** The shared record an agent record replaces for that agent. */
export const OVERRIDES = Type.Optional(
  Type.String({
    minLength: 1,
    description: 'ID of a shared record this agent record replaces for the agent only',
  }),
)
/** An entry ID an extract job cites as evidence. */
export const ENTRY = Type.Optional(
  Type.Integer({ minimum: 0, description: 'Entry ID; extraction cites its entries' }),
)

/** A tool result of one text block. */
export function text(value: string) {
  return { output: [{ type: 'text' as const, text: value }] }
}

/** Records as lines the model can cite by `id` and `revision`. */
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

/** An operation result as one line for the model, telling it what to do on a conflict. */
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
  }
}

/**
 * The agent a job's records come from: its source agent, or the agent of the scope it consolidates.
 */
export function sourceAgentOf(job: MemoryJob, scope: Scope): string {
  if ('sourceAgentId' in job) return job.sourceAgentId
  return scope.slice(scope.indexOf(':') + 1)
}

/** What the model chooses about a record; everything else comes from the job. */
export interface RecordArgs {
  kind: RecordKind
  content: string
  importance?: number
  sourceEntryFrom?: number
  sourceEntryTo?: number
  overrides?: string
}

/**
 * Ownership and evidence of a write or invalidation, derived from the job.
 *
 * @throws {@link Error} When an extraction does not cite entries after its checkpoint.
 */
export function recordEvidence(
  job: MemoryJob,
  args: Pick<RecordArgs, 'sourceEntryFrom' | 'sourceEntryTo'>,
): RecordEvidence {
  const scope = jobScope(job)
  const base = { scope, sourceAgentId: sourceAgentOf(job, scope) }
  switch (job.kind) {
    case 'remember':
      return {
        ...base,
        origin: job.origin,
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
      return { ...base, origin: 'consolidation' }
  }
}

/**
 * Build a record with job-derived ownership and evidence, and model-selected content.
 *
 * @throws {@link Error} When a shared record would override or extraction lacks valid citations.
 */
export function recordFor(job: MemoryJob, args: RecordArgs, now: number): NewRecord {
  const evidence = recordEvidence(job, args)
  if (args.overrides !== undefined && !evidence.scope.startsWith('agent:')) {
    throw new Error('Only an agent record can override a shared record')
  }
  return {
    ...evidence,
    kind: args.kind,
    content: args.content.trim(),
    importance:
      args.importance ??
      (job.kind === 'remember' ? (job.origin === 'user_request' ? 0.7 : 0.4) : undefined),
    ...(args.overrides === undefined ? {} : { overrides: args.overrides }),
    observedAt: now,
  }
}

/**
 * A tool that applies one operation for the running job. The operation ID comes from the job and the
 * tool call, so a replayed call applies once.
 *
 * @param definition - The tool, with `operation` building the operation from its arguments.
 * @throws {@link Error} When no job is running, or the call would change a shared record without
 * `shared_write`.
 */
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
      if (job.kind === 'extract') {
        const through = await extractionReadThrough(deps, running)
        const end =
          op.type === 'checkpoint'
            ? op.lastEntryId
            : op.type === 'write' || op.type === 'supersede'
              ? op.record.sourceEntries?.to
              : op.type === 'invalidate'
                ? op.evidence.sourceEntries?.to
                : undefined
        if (end !== undefined && end > through) {
          throw new Error(`Entry ${end} exceeds the job's read range through ${through}`)
        }
      }
      if (job.kind === 'consolidate' && job.scope.startsWith('shared:') && op.type !== 'decline') {
        throw new Error(
          'Shared records change only through shared_write, which checks their sources',
        )
      }
      await definition.prepare?.(args, running.job)
      const result = await applyOperation(
        memoryDb(deps.env.MEMORY_DB),
        {
          opId: await sha256Hex(`${running.jobId}:${api.callId}`),
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
