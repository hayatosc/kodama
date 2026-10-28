/**
 * Writing shared memory. The memory agent writes a shared record only when code finds it backed
 * by the records of at least two agents, so one agent's quirk or one poisoned conversation cannot
 * reach every agent. No person approves a change.
 *
 * @see docs/memory.md — Shared memory
 *
 * @module
 */
import type { Scope } from '../../drizzle/memory/schema.ts'
import type { MemoryDb, RecordKind } from './store/db.ts'
import { applyOperation, recordSharedRejection } from './store/records.ts'
import { activeRecordRevision, activeRecordsById } from './store/queries.ts'
import type { NewRecord } from './store/records.ts'
import type { OperationContext, OperationResult } from './store/statements.ts'

/** The source agent of shared records, which belong to no single agent. */
export const SHARED_SOURCE_AGENT = 'memory'
/** Agents whose own active records must back a record brought into a space. */
export const MIN_SOURCE_AGENTS = 2

const SPACE_PATTERN = /^[a-z0-9-]{1,64}$/

/**
 * The scope of a shared space.
 *
 * @throws {@link TypeError} When `space` is not 1–64 lowercase letters, digits, or hyphens.
 */
export function sharedScope(space: string): Scope {
  if (!SPACE_PATTERN.test(space)) throw new TypeError(`Invalid shared space: ${space}`)
  return `shared:${space}`
}

/** A record to write to a shared space. */
export interface SharedWrite {
  space: string
  kind: RecordKind
  content: string
  importance?: number
  /** A team rule that agent records cannot override. */
  required?: boolean
  /** The active shared record of the space this one replaces. */
  replaces?: string
  /** The active records the write rests on. */
  sourceIds: readonly string[]
}

/**
 * Why a write may not change the space, or undefined when it may. Bringing a record into a space
 * needs active records of two agents; reorganizing a space needs sources that are all its own
 * active records, in a consolidate job of that space. A required record needs two agents, or
 * sources that are already required.
 *
 * @remarks
 * Reorganizing is limited to the space's own job because its content is not bound to its sources:
 * a job of one agent's scope, which reads that agent's records, could otherwise cite any record of
 * the space and write what that agent alone wants.
 */
async function rejection(
  db: MemoryDb,
  scope: Scope,
  jobScope: Scope,
  write: SharedWrite,
): Promise<string | undefined> {
  if (write.sourceIds.length === 0) return 'cite the records the write rests on'
  const sources = await activeRecordsById(db, write.sourceIds)
  if (sources.length !== new Set(write.sourceIds).size)
    return 'every source must be an active record'
  const agents = new Set(sources.filter((r) => r.scope.startsWith('agent:')).map((r) => r.scope))
  const reorganizes = jobScope === scope && sources.every((record) => record.scope === scope)
  if (agents.size < MIN_SOURCE_AGENTS && !reorganizes) {
    return `a shared record needs records of ${MIN_SOURCE_AGENTS} agents, or only records of ${scope} in its own consolidate job`
  }
  if (write.required === true && agents.size < MIN_SOURCE_AGENTS) {
    if (!sources.every((record) => record.required)) {
      return `a required record needs records of ${MIN_SOURCE_AGENTS} agents`
    }
  }
  return undefined
}

/**
 * Check a shared write and apply it as one operation.
 *
 * @param jobScope - The scope of the consolidate job that writes.
 * @returns `rejected` with the reason when a check fails; the write then changes nothing but the
 * ledger.
 * @throws {@link TypeError} When the space name is invalid.
 */
export async function writeShared(
  db: MemoryDb,
  context: OperationContext,
  input: SharedWrite,
  jobScope: Scope,
): Promise<(OperationResult & { replayed: boolean }) | { status: 'rejected'; reason: string }> {
  const scope = sharedScope(input.space)
  const write = { ...input, content: input.content.trim() }
  const reason = await rejection(db, scope, jobScope, write)
  if (reason !== undefined) {
    await recordSharedRejection(db, context, scope, write.content, reason)
    return { status: 'rejected', reason }
  }
  const record: NewRecord = {
    scope,
    kind: write.kind,
    content: write.content,
    origin: 'shared',
    sourceAgentId: SHARED_SOURCE_AGENT,
    ...(write.importance === undefined ? {} : { importance: write.importance }),
    ...(write.required === undefined ? {} : { required: write.required }),
    observedAt: context.now,
  }
  if (write.replaces === undefined) return applyOperation(db, context, { type: 'write', record })
  const old = await activeRecordRevision(db, write.replaces)
  if (old?.scope !== scope) {
    return { status: 'rejected', reason: `no active record ${write.replaces} in ${scope}` }
  }
  return applyOperation(db, context, {
    type: 'supersede',
    oldId: write.replaces,
    oldRevision: old.revision,
    record,
  })
}
