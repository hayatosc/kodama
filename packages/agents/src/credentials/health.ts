/** Lease-guarded refresh health and safe failure audit, independent of secret persistence. @module */
import type { ManagementDb } from '../control-plane/db.ts'
import { prepareQuery, runBatch } from '../lib/reylo.ts'
import { REFRESH_REJECTED } from './refresh.ts'
import insertRefreshFailureAudit from './sql/insert-refresh-failure-audit.sql'
import selectCredentialById from './sql/select-credential-by-id.sql'
import updateRefreshFailure from './sql/update-refresh-failure.sql'
import type { CredentialRow, REFRESH_FAILURE_CATEGORIES } from './vault.ts'
import { parseCredentialRow } from './vault.ts'

type FailureCategory = (typeof REFRESH_FAILURE_CATEGORIES)[number]

function category(error: unknown): FailureCategory {
  if (!(error instanceof Error)) return 'failed'
  if (error.message === REFRESH_REJECTED) return 'rejected'
  if (
    error.message === 'credential_unavailable: invalid OAuth refresh response' ||
    error.message === 'credential_unavailable: invalid credential payload' ||
    error.message === 'credential_unavailable: credential kind cannot change'
  )
    return 'malformed'
  if (
    error.message === 'credential_unavailable: OAuth refresh request failed' ||
    error.message === 'credential_unavailable: OAuth refresh temporarily unavailable'
  )
    return 'transient'
  return 'failed'
}

/** Count a failed refresh once, only while its original active revision/lease is still live. */
export async function recordRefreshFailure(
  db: ManagementDb,
  leased: CredentialRow,
  leaseId: string,
  at: number,
  error: unknown,
): Promise<CredentialRow | undefined> {
  const failure = category(error)
  const [, updatedResult] = await runBatch(db, [
    prepareQuery(db, insertRefreshFailureAudit, {
      opId: leaseId,
      at,
      action: failure === 'rejected' ? 'credential.needs_reauth' : 'credential.refresh.failed',
      detailJson: JSON.stringify({
        kind: leased.kind,
        provider: leased.provider,
        category: failure,
      }),
      credentialId: leased.credentialId,
      leaseId,
      revision: leased.revision,
      atBound: at,
    }),
    prepareQuery(db, updateRefreshFailure, {
      needsReauth: failure === 'rejected' ? 1 : 0,
      at,
      category: failure,
      credentialId: leased.credentialId,
      leaseId,
      revision: leased.revision,
      atBound: at,
    }),
  ])
  if ((updatedResult?.meta.changes ?? 0) === 0) return undefined
  const row = await selectCredentialById.run(db, { credentialId: leased.credentialId })
  return row ? parseCredentialRow(row) : undefined
}
