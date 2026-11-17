/**
 * Data-access repository for credential refresh failure health and usage timestamps.
 *
 * @module
 */
import type { ManagementDb } from '../control-plane/db.ts'
import { prepareQuery, runBatch } from '../lib/reylo.ts'
import { queries } from './queries/index.ts'
import { findCredentialById } from './vault.repository.ts'
import type { CredentialRow } from './vault.repository.ts'

/** Atomically record a refresh failure audit entry and increment failure counters under lease. */
export async function applyRefreshFailure(
  db: ManagementDb,
  params: {
    opId: string
    at: number
    action: string
    detailJson: string
    needsReauth: number
    category: string
    credentialId: string
    leaseId: string
    revision: number
  },
): Promise<CredentialRow | undefined> {
  const [, updatedResult] = await runBatch(db, [
    prepareQuery(db, queries.insertRefreshFailureAudit, {
      opId: params.opId,
      at: params.at,
      action: params.action,
      detailJson: params.detailJson,
      credentialId: params.credentialId,
      leaseId: params.leaseId,
      revision: params.revision,
      atBound: params.at,
    }),
    prepareQuery(db, queries.updateRefreshFailure, {
      needsReauth: params.needsReauth,
      at: params.at,
      category: params.category,
      credentialId: params.credentialId,
      leaseId: params.leaseId,
      revision: params.revision,
      atBound: params.at,
    }),
  ])
  if ((updatedResult?.meta.changes ?? 0) === 0) return undefined
  return findCredentialById(db, params.credentialId)
}

/** Update last observed selection only if this ingestion page still owns its checkpoint. */
export function lastUsedStatement(
  db: ManagementDb,
  credentialId: string,
  at: number,
  agentId: string,
  after: number,
): D1PreparedStatement {
  return prepareQuery(db, queries.updateCredentialLastUsed, {
    at,
    atMax: at,
    credentialId,
    agentId,
    after,
  })
}
