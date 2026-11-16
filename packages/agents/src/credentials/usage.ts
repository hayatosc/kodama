/** Credential-owned accounting metadata; never reads encrypted provider material. @module */
import type { ManagementDb } from '../control-plane/db.ts'
import { prepareQuery } from '../lib/reylo.ts'
import updateCredentialLastUsed from './sql/update-credential-last-used.sql'

/** Update last observed selection only if this ingestion page still owns its checkpoint. */
export function lastUsedStatement(
  db: ManagementDb,
  credentialId: string,
  at: number,
  agentId: string,
  after: number,
): D1PreparedStatement {
  return prepareQuery(db, updateCredentialLastUsed, {
    at,
    atMax: at,
    credentialId,
    agentId,
    after,
  })
}
