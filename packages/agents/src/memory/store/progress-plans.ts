/**
 * Plans of the operations that record progress: extraction checkpoints and declined candidates.
 *
 * @module
 */
import {
  findExtractionCheckpointRow,
  insertExtractionCheckpointStatement,
  updateExtractionCheckpointStatement,
} from './checkpoint.repository.ts'
import type { MemoryDb } from './db.ts'
import type { Operation } from './records.service.ts'
import { claimRevision, insertOp, recordLedger } from './statements.repository.ts'
import type { OperationContext, OperationResult, Plan, Statement } from './statements.repository.ts'

/** Plan advancing an agent's extraction checkpoint; a checkpoint already past it stays. */
export async function planCheckpoint(
  db: MemoryDb,
  context: OperationContext,
  op: Extract<Operation, { type: 'checkpoint' }>,
): Promise<Plan> {
  const current = await findExtractionCheckpointRow(db, op.agentId)
  const result: OperationResult = { status: 'applied', recordId: op.agentId }
  if (current !== undefined && current.lastEntryId >= op.lastEntryId) {
    return { result, statements: [insertOp(db, context, op.type, result)] }
  }
  const advance: Statement[] =
    current === undefined
      ? [insertExtractionCheckpointStatement(db, op.agentId, op.lastEntryId, context.now)]
      : [
          updateExtractionCheckpointStatement(db, {
            agentId: op.agentId,
            lastEntryId: op.lastEntryId,
            nextRevision: current.revision + 1,
            revision: current.revision,
            updatedAt: context.now,
          }),
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
