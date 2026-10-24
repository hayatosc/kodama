/**
 * Write operations on memory records, and applying each at most once.
 *
 * @see docs/memory.md — Applying a write, Freshness
 *
 * @module
 */
import type { MemoryDb, RecordKind, RecordOrigin } from './db.ts'
import { planArchiveSummary, planCheckpoint, planDecline } from './progress-plans.ts'
import { planInvalidate, planSupersede, planWrite } from './record-plans.ts'
import type { Scope } from '../../../drizzle/d1/schema.ts'
import { errorText } from '../../lib/errors.ts'
import { appliedResult } from './statements.ts'
import type { OperationContext, OperationResult, Plan } from './statements.ts'

/** A record to write. The code that builds it from a job sets the scope, origin, and evidence. */
export interface NewRecord {
  scope: Scope
  kind: RecordKind
  content: string
  origin: RecordOrigin
  sourceAgentId: string
  /** Inclusive range of the entries of the source agent that the record rests on. */
  sourceEntries?: { from: number; to: number }
  /** 0 to 1; defaults to 0.5. */
  importance?: number
  /** For an agent record: the ID of the shared record it replaces for this agent. */
  overrides?: string
  /** For a shared fact or instruction that agent records cannot override. */
  required?: boolean
  observedAt: number
}

/** Trusted ownership and evidence of a record change, supplied by the running job or maintenance. */
export type RecordEvidence = Pick<NewRecord, 'scope' | 'origin' | 'sourceAgentId' | 'sourceEntries'>

/** A change the memory agent makes, applied as one operation. */
export type Operation =
  | { type: 'write'; record: NewRecord }
  /** Replace an active record of the same scope, named by ID at the revision the writer read. */
  | { type: 'supersede'; oldId: string; oldRevision: number; record: NewRecord }
  | {
      type: 'invalidate'
      id: string
      revision: number
      reason: string
      evidence: RecordEvidence
    }
  /** Keep a declined candidate in the ledger only. */
  | { type: 'decline'; candidate: string; reason: string }
  /** Record that extraction has covered an agent's entries through `lastEntryId`. */
  | { type: 'checkpoint'; agentId: string; lastEntryId: number }
  /** Record that the summary of an archived segment is in R2. */
  | { type: 'archive_summary'; segmentId: string }

async function plan(db: MemoryDb, context: OperationContext, op: Operation): Promise<Plan> {
  switch (op.type) {
    case 'write':
      return planWrite(db, context, op)
    case 'supersede':
      return planSupersede(db, context, op)
    case 'invalidate':
      return planInvalidate(db, context, op)
    case 'checkpoint':
      return planCheckpoint(db, context, op)
    case 'archive_summary':
      return planArchiveSummary(db, context, op)
    case 'decline':
      return planDecline(db, context, op)
  }
}

/**
 * Apply one operation at most once.
 *
 * @returns The operation's result, with `replayed` when an earlier attempt with the same `opId`
 * already applied it. A broken precondition returns `conflict` and changes nothing.
 * @throws {@link TypeError} When the record breaks a rule the columns cannot express.
 */
export function applyOperation(
  db: MemoryDb,
  context: OperationContext,
  op: Operation,
): Promise<OperationResult & { replayed: boolean }> {
  return applyPlan(db, context, () => plan(db, context, op))
}

/**
 * Apply the batch `makePlan` builds at most once per `opId`, for changes other modules plan, such
 * as skills.
 *
 * @remarks
 * The plan reads its targets; if one changed before the batch, a revision claim fails, the batch
 * rolls back, and the result is `conflict`.
 */
export async function applyPlan(
  db: MemoryDb,
  context: OperationContext,
  makePlan: () => Promise<Plan>,
): Promise<OperationResult & { replayed: boolean }> {
  const earlier = await appliedResult(db, context.opId)
  if (earlier !== undefined) return { ...earlier, replayed: true }

  const { result, statements } = await makePlan()
  await context.beforeBatch?.()
  try {
    await db.batch(statements)
  } catch (error) {
    const text = errorText(error)
    if (!/constraint/i.test(text)) throw error
    // Another attempt applied the same operation first, or a target changed after the read.
    const applied = await appliedResult(db, context.opId)
    if (applied !== undefined) return { ...applied, replayed: true }
    const reason = /memory_records\.id/.test(text) ? 'duplicate' : 'changed_during_write'
    return { status: 'conflict', reason, replayed: false }
  }
  return { ...result, replayed: false }
}
