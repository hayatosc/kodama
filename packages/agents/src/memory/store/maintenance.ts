/**
 * Bounded D1 maintenance queries and updates used by daily consolidation.
 *
 * @see docs/memory.md — Consolidate
 *
 * @module
 */
import { prepareQuery, runBatch, runChanges } from '../../lib/reylo.ts'
import { SEARCH_VERSION } from '../../lib/search-text.ts'
import { parseMemoryRecord, parseScope } from './db.ts'
import type { MemoryDb, MemoryRecord, Scope } from './db.ts'
import { applyOperation } from './records.ts'
import countActiveRecordsByScope from './sql/count-active-records-by-scope.sql'
import deleteMemoryTermsByRecord from './sql/delete-memory-terms-by-record.sql'
import deleteOldMemoryLedger from './sql/delete-old-memory-ledger.sql'
import deleteOldRevisionClaims from './sql/delete-old-revision-claims.sql'
import insertMemoryLedger from './sql/insert-memory-ledger.sql'
import probeMemoryLedger from './sql/probe-memory-ledger.sql'
import selectChangedScopesAfter from './sql/select-changed-scopes-after.sql'
import selectChangedScopesAll from './sql/select-changed-scopes-all.sql'
import selectChangedScopesWrap from './sql/select-changed-scopes-wrap.sql'
import selectConsolidationRecords from './sql/select-consolidation-records.sql'
import selectOverridesOfRequired from './sql/select-overrides-of-required.sql'
import selectResegmentRecords from './sql/select-resegment-records.sql'
import updateRecordSearchVersion from './sql/update-record-search-version.sql'
import { termStatements } from './statements.ts'

/** Records one `consolidate` job reads. */
export const CONSOLIDATION_RECORD_LIMIT = 200
/** Scopes consolidated per day; the rest wait for a later run. */
export const SCOPES_PER_DAY = 200
/** Rows one maintenance step touches, to stay within one invocation's limits. */
const BATCH_ROWS = 500

/**
 * Up to `limit` scopes with a record written or changed since `since`, in scope order, starting
 * after `after` and wrapping around to the first.
 *
 * @remarks
 * The caller passes the last scope of the previous run as `after`, so when more than `limit`
 * scopes change every day, each run continues where the last one stopped instead of taking the
 * same scopes again.
 */
export async function changedScopes(
  db: MemoryDb,
  since: number,
  after: Scope | undefined,
  limit = SCOPES_PER_DAY,
): Promise<Scope[]> {
  if (after === undefined) {
    const rows = await selectChangedScopesAll.run(db, { since, limit })
    return rows.map((row) => parseScope(row.scope))
  }
  const rest = await selectChangedScopesAfter.run(db, { since, after, limit })
  const wrapped =
    rest.length === limit
      ? []
      : await selectChangedScopesWrap.run(db, { since, after, limit: limit - rest.length })
  return [...rest, ...wrapped].map((row) => parseScope(row.scope))
}

/** Active records of a scope for a `consolidate` job, most used first within each kind. */
export async function consolidationRecords(db: MemoryDb, scope: Scope): Promise<MemoryRecord[]> {
  const rows = await selectConsolidationRecords.run(db, {
    scope,
    limit: CONSOLIDATION_RECORD_LIMIT,
  })
  return rows.map(parseMemoryRecord)
}

/** Rows rebuilt per batch: each takes a few statements, and a batch should stay small. */
const RESEGMENT_ROWS = 50

/** Rebuild the search terms of records indexed by an older search-text function. */
export async function resegmentRecords(db: MemoryDb): Promise<number> {
  const rows = await selectResegmentRecords.run(db, {
    searchVersion: SEARCH_VERSION,
    limit: RESEGMENT_ROWS,
  })
  await runBatch(
    db,
    rows.flatMap((row) => [
      prepareQuery(db, deleteMemoryTermsByRecord, { recordId: row.id }),
      ...termStatements(db, row.id, row.content),
      prepareQuery(db, updateRecordSearchVersion, { id: row.id, searchVersion: SEARCH_VERSION }),
    ]),
  )
  return rows.length
}

/**
 * Delete revision claims older than the rollback window: a writer that read a revision that long
 * ago has long since finished.
 */
export async function forgetOldClaims(db: MemoryDb, before: number): Promise<void> {
  await deleteOldRevisionClaims.run(db, { before })
}

/**
 * Delete ledger rows older than `before`, a batch at a time.
 *
 * @returns How many were deleted in this call.
 */
export function forgetOldLedger(db: MemoryDb, before: number): Promise<number> {
  // Keep the IDs in SQLite: expanding them into bindings would exceed D1's 100-parameter limit.
  return runChanges(db, deleteOldMemoryLedger, { before, limit: BATCH_ROWS })
}

/** Log the database size and the active records per scope, to watch growth against D1's limit. */
export async function recordSizes(db: MemoryDb, runId: string, now: number): Promise<void> {
  // Every D1 result reports the database size after the statement.
  const probe = await prepareQuery(db, probeMemoryLedger).run()
  const counts = await countActiveRecordsByScope.run(db)
  await insertMemoryLedger.run(db, {
    at: now,
    runId,
    opId: null,
    actor: 'consolidation',
    action: 'meta',
    target: 'record',
    targetId: '',
    detailJson: JSON.stringify({ sizeAfter: probe.meta.size_after, counts }),
  })
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
  const rows = await selectOverridesOfRequired.run(db, { limit: BATCH_ROWS })
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
