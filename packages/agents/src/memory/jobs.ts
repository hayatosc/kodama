/**
 * The memory agent's input contract: its name, the job kinds it takes, and their validation.
 *
 * Memory code addresses the memory agent through this module, so it never imports the agent itself.
 *
 * @see docs/memory.md — Jobs
 *
 * @module
 */
import * as v from 'valibot'
import { AgentIdSchema } from '../validation.ts'
import type { Scope } from '../../drizzle/memory/schema.ts'
import { isScope } from './store/db.ts'
import { sha256Hex } from '../lib/hash.ts'

const ScopeSchema = v.custom<Scope>(isScope, 'scope must be agent:<id> or shared:<space>')
const EntryIdSchema = v.pipe(v.number(), v.integer(), v.minValue(0))

/** Every job the memory agent takes: `remember`, `extract`, and `consolidate`. */
export const MemoryJobSchema = v.variant('kind', [
  v.object({
    kind: v.literal('remember'),
    sourceAgentId: AgentIdSchema,
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
    kind: v.literal('consolidate'),
    scope: ScopeSchema,
    /** UTC day, so one consolidation per scope and day. */
    day: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
  }),
])

/** A validated memory job. */
export type MemoryJob = v.InferOutput<typeof MemoryJobSchema>
/** The kind of a memory job. */
export type JobKind = MemoryJob['kind']
/**
 * How a settled job ended: it wrote something (`persisted`), wrote nothing (`declined`), met a
 * changed target (`conflict`), or failed every attempt (`failed`).
 */
export type JobOutcome = 'persisted' | 'declined' | 'conflict' | 'failed'

/** A job's place in the memory agent's queue. */
export interface JobStatus {
  jobId: string
  kind: JobKind
  status: 'queued' | 'running' | 'settled'
  outcome?: JobOutcome
  attempts: number
}

/** Queue priority per kind; lower runs first. */
export const JOB_PRIORITY: Record<JobKind, number> = {
  remember: 0,
  extract: 1,
  consolidate: 2,
}

/**
 * The job's ID, a hash of the fields that identify it.
 *
 * @remarks
 * The same job delivered twice gets the same ID, so the second delivery finds the first.
 */
export function jobId(job: MemoryJob): Promise<string> {
  switch (job.kind) {
    case 'remember':
      return sha256Hex(
        JSON.stringify([job.kind, job.sourceAgentId, job.sourceEntries.from, job.content]),
      )
    case 'extract':
      return sha256Hex(JSON.stringify([job.kind, job.sourceAgentId, job.afterEntry]))
    case 'consolidate':
      return sha256Hex(JSON.stringify([job.kind, job.scope, job.day]))
  }
}

/**
 * Parse an untrusted job.
 *
 * @throws {@link TypeError} With the first issue's message, when `value` is not a valid job.
 */
export function parseMemoryJob(value: unknown): MemoryJob {
  const result = v.safeParse(MemoryJobSchema, value, { abortEarly: true })
  if (result.success) return result.output
  throw new TypeError(result.issues[0].message)
}

/**
 * The name of the one memory agent in the `AGENTS` namespace; an object of that name is a
 * `MemoryAgent`.
 *
 * @remarks
 * The `:` makes it an invalid public agent ID, so `AgentService` and `sendTo` cannot address it.
 */
export const MEMORY_AGENT_NAME = 'kodama:memory'

/** The reserved memory agent registry identity, independent of its transport name. */
export const MEMORY_AGENT_ID = '00000000-0000-7000-8000-00000000000a'
