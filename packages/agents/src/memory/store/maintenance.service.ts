/**
 * Bounded D1 maintenance service used by daily consolidation.
 *
 * @see docs/memory.md — Consolidate
 *
 * @module
 */
import { parseScope } from './db.ts'
import type { MemoryDb } from './db.ts'
import {
  changedScopes,
  CONSOLIDATION_RECORD_LIMIT,
  consolidationRecords,
  forgetOldClaims,
  forgetOldLedger,
  listOverridesOfRequired,
  recordSizes,
  resegmentRecords,
  SCOPES_PER_DAY,
} from './maintenance.repository.ts'
import { applyOperation } from './records.service.ts'

export {
  changedScopes,
  CONSOLIDATION_RECORD_LIMIT,
  consolidationRecords,
  forgetOldClaims,
  forgetOldLedger,
  recordSizes,
  resegmentRecords,
  SCOPES_PER_DAY,
}

/**
 * Mark invalid each agent record that overrides a required shared record.
 *
 * @remarks
 * Such a record is never loaded, because a required record wins. Each change is an operation with
 * its ledger row.
 *
 * @returns How many were marked in this call, at most 500.
 */
export async function invalidateOverridesOfRequired(
  db: MemoryDb,
  runId: string,
  now: number,
): Promise<number> {
  const rows = await listOverridesOfRequired(db)
  for (const row of rows) {
    await applyOperation(
      db,
      {
        opId: `required:${row.id}@${row.revision}`,
        jobId: runId,
        runId,
        actor: 'consolidation',
        now,
      },
      {
        type: 'invalidate',
        id: row.id,
        revision: row.revision,
        reason: 'overrides a required shared record',
        evidence: {
          scope: parseScope(row.scope),
          sourceAgentId: row.sourceAgentId,
          origin: 'consolidation',
        },
      },
    )
  }
  return rows.length
}
