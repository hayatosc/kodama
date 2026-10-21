/**
 * Memory records in D1: write operations and applying them at most once
 * (docs/design/long-term-memory.md, Applying a write, Freshness).
 */
import type { MemoryDb, RecordKind, RecordOrigin } from './db.ts'
import { planArchiveSummary, planCheckpoint, planDecline } from './progress-plans.ts'
import { planInvalidate, planSupersede, planWrite } from './record-plans.ts'
import type { Scope } from './schema/records.ts'
import { appliedResult, errorText } from './statements.ts'
import type { OperationContext, OperationResult, Plan } from './statements.ts'

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

export type Operation =
  | { type: 'write'; record: NewRecord }
  /** Replace an active record of the same scope, named by ID at the revision the writer read. */
  | { type: 'supersede'; oldId: string; oldRevision: number; record: NewRecord }
  | { type: 'invalidate'; id: string; revision: number; reason: string }
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
 * Apply one operation at most once. A repeat with the same `opId` returns the first result and
 * changes nothing; a broken precondition returns `conflict` and changes nothing.
 */
export async function applyOperation(
  db: MemoryDb,
  context: OperationContext,
  op: Operation,
): Promise<OperationResult & { replayed: boolean }> {
  const earlier = await appliedResult(db, context.opId)
  if (earlier !== undefined) return { ...earlier, replayed: true }

  const { result, statements } = await plan(db, context, op)
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
