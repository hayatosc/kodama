/**
 * Shared D1 statement builders and idempotency/audit helpers for memory write operations.
 *
 * @module
 */
import * as v from 'valibot'
import { prepareQuery } from '../../lib/reylo.ts'
import { storedTerms } from '../../lib/search-text.ts'
import type { MemoryDb, Scope } from './db.ts'
import { queries } from './queries/index.ts'

/**
 * The result of an operation: `stale` means the candidate rests on older entries than the record it
 * would replace, so it was declined.
 */
export type OperationResult =
  | { status: 'applied'; recordId: string }
  | { status: 'declined' }
  | { status: 'stale' }
  | { status: 'conflict'; reason: string }

/** Who applies an operation, and when. */
export interface OperationContext {
  /** Same for every attempt of one change, for example derived from the job and tool call IDs. */
  opId: string
  jobId: string
  runId: string
  actor: string
  now: number
  /** Test hook that runs between the precondition read and the batch. */
  beforeBatch?: () => Promise<void>
}

const operationResultSchema = v.variant('status', [
  v.object({ status: v.literal('applied'), recordId: v.string() }),
  v.object({ status: v.literal('declined') }),
  v.object({ status: v.literal('stale') }),
  v.object({ status: v.literal('conflict'), reason: v.string() }),
])

/** One statement of a D1 batch. */
export type Statement = D1PreparedStatement
/** The statements of one batch; a batch has at least one. */
export type Statements = [Statement, ...Statement[]]

/**
 * Inserts of a record's search terms using a single SQLite `json_each` statement.
 */
export function termStatements(db: MemoryDb, recordId: string, content: string): Statement[] {
  const terms = storedTerms(content)
  if (terms.length === 0) return []
  return [
    prepareQuery(db, queries.insertMemoryTerms, {
      recordId,
      termsJson: JSON.stringify(terms),
    }),
  ]
}

/** The `memory_ops` row that records an operation and its result, so a repeat finds it. */
export function insertOp(
  db: MemoryDb,
  context: OperationContext,
  op: string,
  result: OperationResult,
): Statement {
  return prepareQuery(db, queries.insertMemoryOp, {
    opId: context.opId,
    jobId: context.jobId,
    op,
    resultJson: JSON.stringify(result),
    appliedAt: context.now,
  })
}

/**
 * Claim the revision a change moves its target to.
 *
 * @remarks
 * With the update guarded by the revision it read, a second writer from that revision fails on
 * this claim's primary key, and its whole batch rolls back.
 */
export function claimRevision(
  db: MemoryDb,
  context: OperationContext,
  target: 'record' | 'checkpoint' | 'skill' | 'task',
  targetId: string,
  revision: number,
): Statement {
  return prepareQuery(db, queries.insertRevisionClaim, {
    target,
    targetId,
    revision,
    opId: context.opId,
    claimedAt: context.now,
  })
}

/** A new value each time; scope revisions are compared for equality only. */
function newScopeRevision(): number {
  const [high = 0, low = 0] = crypto.getRandomValues(new Uint32Array(2))
  return high * 2 ** 20 + (low >>> 12)
}

/** Give a scope a new revision, so agents reading it refresh their always-loaded copy. */
export function bumpScope(db: MemoryDb, context: OperationContext, scope: Scope): Statement {
  return prepareQuery(db, queries.insertScopeRevisionUpsert, {
    scope,
    revision: newScopeRevision(),
    updatedAt: context.now,
  })
}

/** The stored result of an operation that was already applied, if any. */
export async function appliedResult(
  db: MemoryDb,
  opId: string,
): Promise<OperationResult | undefined> {
  const row = await queries.getMemoryOp.run(db, { opId })
  if (row === null) return undefined
  const parsed: unknown = JSON.parse(row.resultJson)
  return v.parse(operationResultSchema, parsed)
}

/** The result an operation will have, and the statements of its batch. */
export type Plan = { result: OperationResult; statements: Statements }

/** A ledger row for an operation. */
export function recordLedger(
  db: MemoryDb,
  context: OperationContext,
  action: string,
  targetId: string,
  detail: unknown,
  target: 'record' | 'skill' | 'task' = 'record',
): Statement {
  return prepareQuery(db, queries.insertMemoryLedger, {
    at: context.now,
    runId: context.runId,
    opId: context.opId,
    actor: context.actor,
    action,
    target,
    targetId,
    detailJson: JSON.stringify(detail),
  })
}

/**
 * A plan that changes nothing but logs the conflict, so the candidate can be evaluated again
 * later.
 */
export function conflict(
  db: MemoryDb,
  context: OperationContext,
  targetId: string,
  reason: string,
  target: 'record' | 'skill' | 'task' = 'record',
): Plan {
  return {
    result: { status: 'conflict', reason },
    statements: [recordLedger(db, context, 'conflict', targetId, { reason }, target)],
  }
}
