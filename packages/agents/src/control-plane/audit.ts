/**
 * The audit log: the row a change appends in its own batch, and reading a change back by its retry
 * key.
 *
 * @see docs/agents.md — Management database
 *
 * @module
 */
import { and, desc, eq, lt } from 'drizzle-orm'
import type { AuditQuery } from '../protocol.ts'
import * as v from 'valibot'
import { auditLog } from '../../drizzle/management/schema.ts'
import type { ManagementDb } from './db.ts'

const DetailSchema = v.record(
  v.string(),
  v.union([v.string(), v.number(), v.boolean(), v.null(), v.array(v.string())]),
)

/** One audit row; `detail` holds IDs, versions, and names, never secrets. */
export interface AuditEntry {
  opId: string
  at: number
  /** The acting principal; `null` for the system. */
  actorId: string | null
  action: string
  targetKind: 'agent' | 'principal' | 'system'
  targetId: string
  detail?: Record<string, string | number | boolean | null | string[] | undefined>
}

/**
 * The insert of one audit row, to run in the batch of the change it records. A second change with
 * the same `opId` fails on its unique key, which rolls that batch back.
 */
export function auditStatement(db: ManagementDb, entry: AuditEntry) {
  const { detail, ...row } = entry
  return db.insert(auditLog).values({ ...row, detailJson: JSON.stringify(detail ?? {}) })
}

/** Retained audit metadata, newest first; reads neither decrypt nor append events. */
export async function readAudit(db: ManagementDb, query: AuditQuery & { limit: number }) {
  const rows = await db
    .select()
    .from(auditLog)
    .where(
      and(
        query.targetId ? eq(auditLog.targetId, query.targetId) : undefined,
        query.before === undefined ? undefined : lt(auditLog.seq, query.before),
      ),
    )
    .orderBy(desc(auditLog.seq))
    .limit(query.limit + 1)
  const entries = rows.slice(0, query.limit).map(({ detailJson, ...row }) => {
    const detail = v.parse(DetailSchema, JSON.parse(detailJson))
    return { ...row, detail }
  })
  return { entries, nextCursor: rows.length > query.limit ? (entries.at(-1)?.seq ?? null) : null }
}

/** The audit row of an earlier change with this retry key, if it was applied. */
export function auditByOpId(db: ManagementDb, opId: string) {
  return db.select().from(auditLog).where(eq(auditLog.opId, opId)).get()
}
