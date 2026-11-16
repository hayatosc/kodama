/**
 * The audit log: the row a change appends in its own batch, and reading a change back by its retry
 * key.
 *
 * @see docs/agents.md — Management database
 *
 * @module
 */
import * as v from 'valibot'
import { parseEnum, prepareQuery } from '../lib/reylo.ts'
import type { AuditQuery } from '../protocol.ts'
import { AUDIT_TARGETS, MANAGEMENT_SOURCES } from './db.ts'
import type { ManagementDb } from './db.ts'
import insertAudit from './sql/insert-audit.sql'
import insertAuditIgnore from './sql/insert-audit-ignore.sql'
import readAuditQuery from './sql/read-audit.sql'
import selectAuditByOpId from './sql/select-audit-by-op-id.sql'

const DetailSchema = v.record(
  v.string(),
  v.union([v.string(), v.number(), v.boolean(), v.null(), v.array(v.string())]),
)

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
 * The insert of one audit row, to run in the batch of the change it records. A second change with
 * the same `opId` fails on its unique key, which rolls that batch back.
 */
export function auditStatement(db: ManagementDb, entry: AuditEntry): D1PreparedStatement {
  return prepareQuery(db, insertAudit, auditParams(entry))
}

/**
 * Idempotent insert of one audit row, ignoring conflicts on `opId` for replayable completion
 * writes inside a batch.
 */
export function auditIgnoreStatement(db: ManagementDb, entry: AuditEntry): D1PreparedStatement {
  return prepareQuery(db, insertAuditIgnore, auditParams(entry))
}

/** Retained audit metadata, newest first; reads neither decrypt nor append events. */
export async function readAudit(db: ManagementDb, query: AuditQuery & { limit: number }) {
  const rows = await readAuditQuery.run(db, {
    targetId: query.targetId || null,
    before: query.before ?? null,
    limit: query.limit + 1,
  })
  const entries = rows.slice(0, query.limit).map(({ detailJson, ...row }) => {
    const detail = v.parse(DetailSchema, JSON.parse(detailJson))
    return {
      ...row,
      source: parseEnum(MANAGEMENT_SOURCES, row.source, 'audit source'),
      targetKind: parseEnum(AUDIT_TARGETS, row.targetKind, 'audit targetKind'),
      detail,
    }
  })
  return { entries, nextCursor: rows.length > query.limit ? (entries.at(-1)?.seq ?? null) : null }
}

/** The audit row of an earlier change with this retry key, if it was applied. */
export async function auditByOpId(db: ManagementDb, opId: string) {
  const row = await selectAuditByOpId.run(db, { opId })
  if (row === null) return undefined
  return {
    ...row,
    source: parseEnum(MANAGEMENT_SOURCES, row.source, 'audit source'),
    targetKind: parseEnum(AUDIT_TARGETS, row.targetKind, 'audit targetKind'),
  }
}
