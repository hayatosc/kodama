/**
 * Data-access repository for bounded D1 maintenance queries and updates in daily consolidation.
 *
 * @see docs/memory.md — Consolidate
 *
 * @module
 */
import { prepareQuery, runBatch, runChanges } from '../../lib/reylo.ts'
import { SEARCH_VERSION } from '../../lib/search-text.ts'
import { parseMemoryRecord, parseScope } from './db.ts'
import type { MemoryDb, MemoryRecord, Scope } from './db.ts'
import { queries } from './queries/index.ts'
import { termStatements } from './statements.repository.ts'

/** Records one `consolidate` job reads. */
export const CONSOLIDATION_RECORD_LIMIT = 200
/** Scopes consolidated per day; the rest wait for a later run. */
export const SCOPES_PER_DAY = 200
/** Rows rebuilt per search-text migration batch. */
const RESEGMENT_ROWS = 50
/** Rows one maintenance step touches to stay within D1 invocation limits. */
const BATCH_ROWS = 500

/**
 * Up to `limit` scopes with a record written or changed since `since`, in scope order, starting
 * after `after` and wrapping around to the first.
 */
export async function changedScopes(
  db: MemoryDb,
  since: number,
  after: Scope | undefined,
  limit = SCOPES_PER_DAY,
): Promise<Scope[]> {
  if (after === undefined) {
    const rows = await queries.listChangedScopesAll.run(db, { since, limit })
    return rows.map((row) => parseScope(row.scope))
  }
  const rest = await queries.listChangedScopesAfter.run(db, { since, after, limit })
  const wrapped =
    rest.length === limit
      ? []
      : await queries.listChangedScopesWrap.run(db, { since, after, limit: limit - rest.length })
  return [...rest, ...wrapped].map((row) => parseScope(row.scope))
}

/** Active records of a scope for a `consolidate` job, most used first within each kind. */
export async function consolidationRecords(db: MemoryDb, scope: Scope): Promise<MemoryRecord[]> {
  const rows = await queries.listConsolidationRecords.run(db, {
    scope,
    limit: CONSOLIDATION_RECORD_LIMIT,
  })
  return rows.map(parseMemoryRecord)
}

/** Rebuild the search terms of records indexed by an older search-text function. */
export async function resegmentRecords(db: MemoryDb): Promise<number> {
  const rows = await queries.listResegmentRecords.run(db, {
    searchVersion: SEARCH_VERSION,
    limit: RESEGMENT_ROWS,
  })
  await runBatch(
    db,
    rows.flatMap((row) => [
      prepareQuery(db, queries.deleteMemoryTermsByRecord, { recordId: row.id }),
      ...termStatements(db, row.id, row.content),
      prepareQuery(db, queries.updateRecordSearchVersion, {
        id: row.id,
        searchVersion: SEARCH_VERSION,
      }),
    ]),
  )
  return rows.length
}

/**
 * Delete revision claims older than the rollback window.
 */
export async function forgetOldClaims(db: MemoryDb, before: number): Promise<void> {
  await queries.deleteOldRevisionClaims.run(db, { before })
}

/**
 * Delete ledger rows older than `before`, a batch at a time.
 *
 * @returns How many were deleted in this call.
 */
export function forgetOldLedger(db: MemoryDb, before: number): Promise<number> {
  // Keep the IDs in SQLite: expanding them into bindings would exceed D1's 100-parameter limit.
  return runChanges(db, queries.deleteOldMemoryLedger, { before, limit: BATCH_ROWS })
}

/** Probe database size and log active record counts per scope into the ledger. */
export async function recordSizes(db: MemoryDb, runId: string, now: number): Promise<void> {
  // Every D1 result reports the database size after the statement.
  const probe = await prepareQuery(db, queries.getMemoryLedger).run()
  const counts = await queries.listCountActiveRecordsByScope.run(db)
  await queries.insertMemoryLedger.run(db, {
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

/** List agent records that override a required shared record, bounded to one maintenance batch. */
export async function listOverridesOfRequired(db: MemoryDb) {
  return queries.listOverridesOfRequired.run(db, { limit: BATCH_ROWS })
}
