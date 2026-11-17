/**
 * Data-access repository for the management audit log in management D1.
 *
 * @see docs/agents.md — Management database
 *
 * @module
 */
import { parseEnum, prepareQuery } from '../lib/reylo.ts'
import type { AuditQuery } from '../protocol.ts'
import { AUDIT_TARGETS, MANAGEMENT_SOURCES } from './db.ts'
import type { ManagementDb } from './db.ts'
import { queries } from './queries/index.ts'

/** One audit row; `detail` holds IDs, versions, and names, never secrets. */
export interface AuditEntry {
  opId: string
  at: number
  /** Host-recorded provenance, not an identity or permission. */
  source: 'operator' | 'system'
  action: string
  targetKind: 'agent' | 'system'
  targetId: string
  detail?: Record<string, string | number | boolean | null | string[] | undefined>
}

function auditParams(entry: AuditEntry) {
  return {
    opId: entry.opId,
    at: entry.at,
    source: entry.source,
    action: entry.action,
    targetKind: entry.targetKind,
    targetId: entry.targetId,
    detailJson: JSON.stringify(entry.detail ?? {}),
  }
}

/**
 * Prepare the insert of one audit row, to run in the batch of the change it records. A second
 * change with the same `opId` fails on its unique key, rolling the batch back.
 */
export function auditStatement(db: ManagementDb, entry: AuditEntry): D1PreparedStatement {
  return prepareQuery(db, queries.insertAudit, auditParams(entry))
}

/**
 * Prepare an idempotent insert of one audit row, ignoring conflicts on `opId` for replayable
 * completion writes inside a batch.
 */
export function auditIgnoreStatement(db: ManagementDb, entry: AuditEntry): D1PreparedStatement {
  return prepareQuery(db, queries.insertAuditIgnore, auditParams(entry))
}

/** Fetch retained audit rows, newest first, up to `query.limit + 1` for pagination. */
export async function listAuditRows(db: ManagementDb, query: AuditQuery & { limit: number }) {
  return queries.listAudit.run(db, {
    targetId: query.targetId || null,
    before: query.before ?? null,
    limit: query.limit + 1,
  })
}

/** Fetch the audit row of an earlier change with this retry key, if it was applied. */
export async function findAuditByOpId(db: ManagementDb, opId: string) {
  const row = await queries.getAuditByOpId.run(db, { opId })
  if (row === null) return undefined
  return {
    ...row,
    source: parseEnum(MANAGEMENT_SOURCES, row.source, 'audit source'),
    targetKind: parseEnum(AUDIT_TARGETS, row.targetKind, 'audit targetKind'),
  }
}
