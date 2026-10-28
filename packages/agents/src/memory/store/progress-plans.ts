/**
 * Plans of the operations that record progress: extraction checkpoints and declined candidates.
 *
 * @module
 */
import { and, eq } from 'drizzle-orm'
import type { MemoryDb } from './db.ts'
import type { Operation } from './records.ts'
import { extractionCheckpoints } from '../../../drizzle/memory/schema.ts'
import { claimRevision, insertOp, recordLedger } from './statements.ts'
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
