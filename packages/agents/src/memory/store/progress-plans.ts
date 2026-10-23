/**
 * Plans of the operations that record progress: extraction checkpoints, archive summaries, and
 * declined candidates.
 *
 * @module
 */
import { and, eq } from 'drizzle-orm'
import type { MemoryDb } from './db.ts'
import type { Operation } from './records.ts'
import { archiveSegments, extractionCheckpoints } from '../../../drizzle/d1/schema.ts'
import { claimRevision, conflict, insertOp, recordLedger } from './statements.ts'
import type { OperationContext, OperationResult, Plan, Statement } from './statements.ts'

/** Plan advancing an agent's extraction checkpoint; a checkpoint already past it stays. */
export async function planCheckpoint(
  db: MemoryDb,
  context: OperationContext,
  op: Extract<Operation, { type: 'checkpoint' }>,
): Promise<Plan> {
  const current = await db
    .select()
    .from(extractionCheckpoints)
    .where(eq(extractionCheckpoints.agentId, op.agentId))
    .get()
  const result: OperationResult = { status: 'applied', recordId: op.agentId }
  if (current !== undefined && current.lastEntryId >= op.lastEntryId) {
    return { result, statements: [insertOp(db, context, op.type, result)] }
  }
  const advance: Statement[] =
    current === undefined
      ? [
          db.insert(extractionCheckpoints).values({
            agentId: op.agentId,
            lastEntryId: op.lastEntryId,
            updatedAt: context.now,
          }),
        ]
      : [
          db
            .update(extractionCheckpoints)
            .set({
              lastEntryId: op.lastEntryId,
              revision: current.revision + 1,
              updatedAt: context.now,
            })
            .where(
              and(
                eq(extractionCheckpoints.agentId, op.agentId),
                eq(extractionCheckpoints.revision, current.revision),
              ),
            ),
          claimRevision(db, context, 'checkpoint', op.agentId, current.revision + 1),
        ]
  return {
    result,
    statements: [insertOp(db, context, op.type, result), ...advance],
  }
}

/** Plan marking that a segment's summary is in R2. */
export async function planArchiveSummary(
  db: MemoryDb,
  context: OperationContext,
  op: Extract<Operation, { type: 'archive_summary' }>,
): Promise<Plan> {
  const segment = await db
    .select({ id: archiveSegments.id })
    .from(archiveSegments)
    .where(eq(archiveSegments.id, op.segmentId))
    .get()
  if (segment === undefined) return conflict(db, context, op.segmentId, 'missing_segment')
  const result: OperationResult = { status: 'applied', recordId: op.segmentId }
  return {
    result,
    statements: [
      insertOp(db, context, op.type, result),
      // Segments are never removed while memory runs, so the row read above is still there.
      db
        .update(archiveSegments)
        .set({ hasSummary: true })
        .where(eq(archiveSegments.id, op.segmentId)),
    ],
  }
}

/** Plan logging a declined candidate in the ledger only. */
export async function planDecline(
  db: MemoryDb,
  context: OperationContext,
  op: Extract<Operation, { type: 'decline' }>,
): Promise<Plan> {
  const result: OperationResult = { status: 'declined' }
  return {
    result,
    statements: [
      insertOp(db, context, op.type, result),
      recordLedger(db, context, 'decline', '', { candidate: op.candidate, reason: op.reason }),
    ],
  }
}
