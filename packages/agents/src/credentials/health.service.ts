/** Lease-guarded refresh health and safe failure audit, independent of secret persistence. @module */
import type { ManagementDb } from '../control-plane/db.ts'
import { applyRefreshFailure } from './health.repository.ts'
import { REFRESH_REJECTED } from './refresh.ts'
import type { CredentialRow, REFRESH_FAILURE_CATEGORIES } from './vault.repository.ts'

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
  return applyRefreshFailure(db, {
    opId: leaseId,
    at,
    action: failure === 'rejected' ? 'credential.needs_reauth' : 'credential.refresh.failed',
    detailJson: JSON.stringify({
      kind: leased.kind,
      provider: leased.provider,
      category: failure,
    }),
    needsReauth: failure === 'rejected' ? 1 : 0,
    category: failure,
    credentialId: leased.credentialId,
    leaseId,
    revision: leased.revision,
  })
}
