/**
 * Writing shared memory (docs/memory.md, Shared memory). The memory agent writes a shared record
 * only when code finds it backed by the records of at least two agents, so one agent's quirk or one
 * poisoned conversation cannot reach every agent. No person approves a change.
 */
import { and, eq, inArray } from 'drizzle-orm'
import type { Scope } from '../../drizzle/d1/schema.ts'
import { memoryRecords } from '../../drizzle/d1/schema.ts'
import { looksLikeInjection, redactSecrets } from '../lib/redact.ts'
import type { MemoryDb, RecordKind } from './store/db.ts'
import { applyOperation, applyPlan } from './store/records.ts'
import type { NewRecord } from './store/records.ts'
import { insertOp, recordLedger } from './store/statements.ts'
import type { OperationContext, OperationResult } from './store/statements.ts'

/** Shared records belong to no single agent. */
export const SHARED_SOURCE_AGENT = 'memory'
/** Agents whose own active records must back a record brought into a space. */
export const MIN_SOURCE_AGENTS = 2

const SPACE_PATTERN = /^[a-z0-9-]{1,64}$/

export function sharedScope(space: string): Scope {
  if (!SPACE_PATTERN.test(space)) throw new TypeError(`Invalid shared space: ${space}`)
  return `shared:${space}`
}

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
 * active records. A required record needs two agents, or sources that are already required.
 */
async function rejection(
  db: MemoryDb,
  scope: Scope,
  write: SharedWrite,
): Promise<string | undefined> {
  if (looksLikeInjection(write.content)) return 'the content reads as instructions to obey'
  if (write.sourceIds.length === 0) return 'cite the records the write rests on'
  const sources = await db
    .select()
    .from(memoryRecords)
    .where(and(inArray(memoryRecords.id, [...write.sourceIds]), eq(memoryRecords.status, 'active')))
  if (sources.length !== new Set(write.sourceIds).size)
    return 'every source must be an active record'
  const agents = new Set(sources.filter((r) => r.scope.startsWith('agent:')).map((r) => r.scope))
  const reorganizes = sources.every((record) => record.scope === scope)
  if (agents.size < MIN_SOURCE_AGENTS && !reorganizes) {
    return `a shared record needs records of ${MIN_SOURCE_AGENTS} agents, or only records of ${scope}`
  }
  if (write.required === true && agents.size < MIN_SOURCE_AGENTS) {
    if (!sources.every((record) => record.required)) {
      return `a required record needs records of ${MIN_SOURCE_AGENTS} agents`
    }
  }
  return undefined
}

/**
 * Check a shared write and apply it as one operation. A rejected write changes nothing but the
 * ledger, and the result says why.
 */
export async function writeShared(
  db: MemoryDb,
  context: OperationContext,
  input: SharedWrite,
): Promise<(OperationResult & { replayed: boolean }) | { status: 'rejected'; reason: string }> {
  const scope = sharedScope(input.space)
  const write = { ...input, content: redactSecrets(input.content.trim()) }
  const reason = await rejection(db, scope, write)
  if (reason !== undefined) {
    await applyPlan(db, context, async () => {
      const result: OperationResult = { status: 'declined' }
      return {
        result,
        statements: [
          insertOp(db, context, 'shared_rejected', result),
          recordLedger(db, context, 'shared_rejected', scope, { content: write.content, reason }),
        ],
      }
    })
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
  const old = await db
    .select({ scope: memoryRecords.scope, revision: memoryRecords.revision })
    .from(memoryRecords)
    .where(and(eq(memoryRecords.id, write.replaces), eq(memoryRecords.status, 'active')))
    .get()
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
