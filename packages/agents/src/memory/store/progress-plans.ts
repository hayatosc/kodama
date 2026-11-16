/**
 * Plans of the operations that record progress: extraction checkpoints and declined candidates.
 *
 * @module
 */
import { prepareQuery } from '../../lib/reylo.ts'
import type { MemoryDb } from './db.ts'
import type { Operation } from './records.ts'
import insertExtractionCheckpoint from './sql/insert-extraction-checkpoint.sql'
import selectExtractionCheckpointRow from './sql/select-extraction-checkpoint-row.sql'
import updateExtractionCheckpoint from './sql/update-extraction-checkpoint.sql'
import { claimRevision, insertOp, recordLedger } from './statements.ts'
import type { OperationContext, OperationResult, Plan, Statement } from './statements.ts'

/** Plan advancing an agent's extraction checkpoint; a checkpoint already past it stays. */
export async function planCheckpoint(
  db: MemoryDb,
  context: OperationContext,
  op: Extract<Operation, { type: 'checkpoint' }>,
): Promise<Plan> {
  const current = await selectExtractionCheckpointRow.run(db, { agentId: op.agentId })
  const result: OperationResult = { status: 'applied', recordId: op.agentId }
  if (current !== null && current.lastEntryId >= op.lastEntryId) {
    return { result, statements: [insertOp(db, context, op.type, result)] }
  }
  const advance: Statement[] =
    current === null
      ? [
          prepareQuery(db, insertExtractionCheckpoint, {
            agentId: op.agentId,
            lastEntryId: op.lastEntryId,
            updatedAt: context.now,
          }),
        ]
      : [
          prepareQuery(db, updateExtractionCheckpoint, {
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
