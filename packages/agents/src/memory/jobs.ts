/** Jobs of the memory agent (docs/memory.md, Jobs). */
import * as v from 'valibot'
import { AgentIdSchema } from '../validation.ts'
import type { Scope } from '../../drizzle/d1/schema.ts'
import { isScope } from './store/scopes.ts'
import { sha256Hex } from '../lib/hash.ts'

const ScopeSchema = v.custom<Scope>(isScope, 'scope must be agent:<id> or shared:<space>')
const EntryIdSchema = v.pipe(v.number(), v.integer(), v.minValue(0))

export const MemoryJobSchema = v.variant('kind', [
  v.object({
    kind: v.literal('remember'),
    sourceAgentId: AgentIdSchema,
    origin: v.picklist(['user_request', 'agent_judgment']),
    content: v.pipe(v.string(), v.minLength(1), v.maxLength(2_000)),
    sourceEntries: v.object({ from: EntryIdSchema, to: EntryIdSchema }),
  }),
  v.object({
    kind: v.literal('extract'),
    sourceAgentId: AgentIdSchema,
    /** Extract entries after this one. */
    afterEntry: EntryIdSchema,
  }),
  v.object({
    kind: v.literal('record_archive'),
    sourceAgentId: AgentIdSchema,
    segmentId: v.pipe(v.string(), v.maxLength(200)),
  }),
  v.object({
    kind: v.literal('consolidate'),
    scope: ScopeSchema,
    /** UTC day, so one consolidation per scope and day. */
    day: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
  }),
])

export type MemoryJob = v.InferOutput<typeof MemoryJobSchema>
export type JobKind = MemoryJob['kind']
export type JobOutcome = 'persisted' | 'declined' | 'conflict' | 'failed'

export interface JobStatus {
  jobId: string
  kind: JobKind
  status: 'queued' | 'running' | 'settled'
  outcome?: JobOutcome
  attempts: number
}

/** Lower runs first. */
export const JOB_PRIORITY: Record<JobKind, number> = {
  remember: 0,
  record_archive: 1,
  extract: 2,
  consolidate: 3,
}

/** The same job delivered twice gets the same ID, so the second delivery finds the first. */
export function jobId(job: MemoryJob): Promise<string> {
  switch (job.kind) {
    case 'remember':
      return sha256Hex(
        JSON.stringify([job.kind, job.sourceAgentId, job.sourceEntries.from, job.content]),
      )
    case 'extract':
      return sha256Hex(JSON.stringify([job.kind, job.sourceAgentId, job.afterEntry]))
    case 'record_archive':
      return sha256Hex(JSON.stringify([job.kind, job.segmentId]))
    case 'consolidate':
      return sha256Hex(JSON.stringify([job.kind, job.scope, job.day]))
  }
}

export function parseMemoryJob(value: unknown): MemoryJob {
  const result = v.safeParse(MemoryJobSchema, value, { abortEarly: true })
  if (result.success) return result.output
  throw new TypeError(result.issues[0].message)
}

/** The one memory agent object; jobs are enqueued at this name. */
export const MEMORY_AGENT_NAME = 'memory'
