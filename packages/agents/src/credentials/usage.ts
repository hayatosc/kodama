/** Credential-owned accounting metadata; never reads encrypted provider material. @module */
import { and, eq, isNull, lt, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { credentials } from '../../drizzle/management/schema.ts'
import type { ManagementDb } from '../control-plane/db.ts'

/** Update last observed selection only if this ingestion page still owns its checkpoint. */
export function lastUsedStatement(db: ManagementDb, credentialId: string, at: number, guard: SQL) {
  return db
    .update(credentials)
    .set({ lastUsedAt: at })
    .where(
      and(
        eq(credentials.credentialId, credentialId),
        guard,
        or(isNull(credentials.lastUsedAt), lt(credentials.lastUsedAt, at)),
      ),
    )
}
