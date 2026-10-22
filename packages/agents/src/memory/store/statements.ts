/** Statements and results that every write operation on the memory database shares. */
import { eq } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import * as v from 'valibot'
import type { MemoryDb } from './db.ts'
import {
  memoryLedger,
  memoryOps,
  memoryTerms,
  revisionClaims,
  scopeRevisions,
} from '../../../drizzle/d1/schema.ts'
import type { Scope } from '../../../drizzle/d1/schema.ts'
import { storedTerms } from '../../lib/search-text.ts'

/** `stale`: the candidate is older than the record it would replace, so it was declined. */
export type OperationResult =
  | { status: 'applied'; recordId: string }
  | { status: 'declined' }
  | { status: 'stale' }
  | { status: 'conflict'; reason: string }

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

export type Statement = BatchItem<'sqlite'>
export type Statements = [Statement, ...Statement[]]

/** Messages of an error and its causes; Drizzle wraps the D1 error in `cause`. */
export function errorText(error: unknown): string {
  const parts: string[] = []
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    parts.push(current.message)
  }
  return parts.join('\n')
}

/** D1 binds at most 100 parameters per statement; a term row takes two. */
const TERMS_PER_STATEMENT = 50

/** Inserts of a record's search terms, in statements D1 accepts. */
export function termStatements(db: MemoryDb, recordId: string, content: string): Statement[] {
  const rows = storedTerms(content).map((term) => ({ term, recordId }))
  const statements: Statement[] = []
  for (let start = 0; start < rows.length; start += TERMS_PER_STATEMENT) {
    statements.push(db.insert(memoryTerms).values(rows.slice(start, start + TERMS_PER_STATEMENT)))
  }
  return statements
}

export function insertOp(
  db: MemoryDb,
  context: OperationContext,
  op: string,
  result: OperationResult,
) {
  return db.insert(memoryOps).values({
    opId: context.opId,
    jobId: context.jobId,
    op,
    resultJson: JSON.stringify(result),
    appliedAt: context.now,
  })
}

/**
 * Claim the revision a change moves its target to. With the update guarded by the revision it
 * read, a second writer from that revision fails here and its whole batch rolls back.
 */
export function claimRevision(
  db: MemoryDb,
  context: OperationContext,
  target: 'record' | 'checkpoint' | 'skill',
  targetId: string,
  revision: number,
) {
  return db
    .insert(revisionClaims)
    .values({ target, targetId, revision, opId: context.opId, claimedAt: context.now })
}

/** A new value each time; scope revisions are compared for equality only. */
function newScopeRevision(): number {
  const [high = 0, low = 0] = crypto.getRandomValues(new Uint32Array(2))
  return high * 2 ** 20 + (low >>> 12)
}

export function bumpScope(db: MemoryDb, context: OperationContext, scope: Scope) {
  const revision = newScopeRevision()
  return db
    .insert(scopeRevisions)
    .values({ scope, revision, updatedAt: context.now })
    .onConflictDoUpdate({ target: scopeRevisions.scope, set: { revision, updatedAt: context.now } })
}

export async function appliedResult(
  db: MemoryDb,
  opId: string,
): Promise<OperationResult | undefined> {
  const row = await db
    .select({ resultJson: memoryOps.resultJson })
    .from(memoryOps)
    .where(eq(memoryOps.opId, opId))
    .get()
  if (row === undefined) return undefined
  const parsed: unknown = JSON.parse(row.resultJson)
  return v.parse(operationResultSchema, parsed)
}

/** The result an operation will have and the statements of its batch. */
export type Plan = { result: OperationResult; statements: Statements }

export function recordLedger(
  db: MemoryDb,
  context: OperationContext,
  action: string,
  targetId: string,
  detail: unknown,
  target: 'record' | 'skill' = 'record',
) {
  return db.insert(memoryLedger).values({
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

/** A conflict changes nothing but is logged, so the candidate can be evaluated again later. */
export function conflict(
  db: MemoryDb,
  context: OperationContext,
  targetId: string,
  reason: string,
): Plan {
  return {
    result: { status: 'conflict', reason },
    statements: [recordLedger(db, context, 'conflict', targetId, { reason })],
  }
}
