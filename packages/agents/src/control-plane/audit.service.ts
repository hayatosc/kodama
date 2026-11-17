/**
 * The audit log service: parsing retained audit entries and looking up idempotency keys.
 *
 * @see docs/agents.md — Management database
 *
 * @module
 */
import * as v from 'valibot'
import { parseEnum } from '../lib/reylo.ts'
import type { AuditQuery } from '../protocol.ts'
import {
  auditIgnoreStatement,
  auditStatement,
  findAuditByOpId,
  listAuditRows,
} from './audit.repository.ts'
import type { AuditEntry } from './audit.repository.ts'
import { AUDIT_TARGETS, MANAGEMENT_SOURCES } from './db.ts'
import type { ManagementDb } from './db.ts'

export { auditIgnoreStatement, auditStatement }
export type { AuditEntry }

const DetailSchema = v.record(
  v.string(),
  v.union([v.string(), v.number(), v.boolean(), v.null(), v.array(v.string())]),
)

/** Retained audit metadata, newest first; reads neither decrypt nor append events. */
export async function readAudit(db: ManagementDb, query: AuditQuery & { limit: number }) {
  const rows = await listAuditRows(db, query)
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
  return findAuditByOpId(db, opId)
}
