/**
 * The audit log: the row a change appends in its own batch, and reading a change back by its retry
 * key.
 *
 * @see docs/agents.md — Management database
 *
 * @module
 */
import { eq } from 'drizzle-orm'
import { auditLog } from '../../drizzle/management/schema.ts'
import type { ManagementDb } from './db.ts'

/** One audit row; `detail` holds IDs, versions, and names, never secrets. */
export interface AuditEntry {
  opId: string
  at: number
  /** The acting principal; `null` for the system. */
  actorId: string | null
  action: string
  targetKind: 'agent' | 'principal' | 'system'
  targetId: string
  detail?: Record<string, unknown>
}

/**
 * The insert of one audit row, to run in the batch of the change it records. A second change with
 * the same `opId` fails on its unique key, which rolls that batch back.
 */
export function auditStatement(db: ManagementDb, entry: AuditEntry) {
  const { detail, ...row } = entry
  return db.insert(auditLog).values({ ...row, detailJson: JSON.stringify(detail ?? {}) })
}

/** The audit row of an earlier change with this retry key, if it was applied. */
export function auditByOpId(db: ManagementDb, opId: string) {
  return db.select().from(auditLog).where(eq(auditLog.opId, opId)).get()
}
