/** Credential-owned accounting metadata; never reads encrypted provider material. @module */
import { and, eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { credentials } from '../../drizzle/management/schema.ts'
import type { ManagementDb } from '../management/db.ts'

/** Update last observed selection only if this ingestion page still owns its checkpoint. */
export function lastUsedStatement(db: ManagementDb, credentialId: string, at: number, guard: SQL) {
  return db
    .update(credentials)
    .set({
      lastUsedAt: sql`max(coalesce(${credentials.lastUsedAt}, 0), ${at})`,
    })
    .where(and(eq(credentials.credentialId, credentialId), guard))
}
