/**
 * Job-derived ownership, evidence, and content rules for memory records; no tool or storage calls.
 *
 * @module
 */
import type { Scope } from '../../drizzle/memory/schema.ts'
import type { MemoryJob } from './jobs.ts'
import type { RecordKind } from './store/db.ts'
import type { NewRecord, RecordEvidence } from './store/records.ts'

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

function sourceAgentOf(job: MemoryJob, scope: Scope): string {
  if ('sourceAgentId' in job) return job.sourceAgentId
  return scope.slice(scope.indexOf(':') + 1)
}

/** What the caller chooses about a record; ownership and provenance come from the job. */
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
      return { ...base, origin: job.origin, sourceEntries: job.sourceEntries }
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
 * Build a record with job-derived ownership and evidence, and caller-selected content.
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

/** Scopes a job searches: its own scope and the global shared space. */
export function searchScopes(job: MemoryJob): Scope[] {
  const own = jobScope(job)
  return own === 'shared:global' ? [own] : [own, 'shared:global']
}
