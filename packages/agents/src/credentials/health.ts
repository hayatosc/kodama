/** Lease-guarded refresh health and safe failure audit, independent of secret persistence. @module */
import { and, eq, gt, sql } from 'drizzle-orm'
import { auditLog, credentials } from '../../drizzle/management/schema.ts'
import type { ManagementDb } from '../management/db.ts'
import { REFRESH_REJECTED } from './refresh.ts'

type FailureCategory = NonNullable<typeof credentials.$inferSelect.lastRefreshFailureCategory>

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
  leased: typeof credentials.$inferSelect,
  leaseId: string,
  at: number,
  error: unknown,
) {
  const failure = category(error)
  const held = and(
    eq(credentials.credentialId, leased.credentialId),
    eq(credentials.leaseId, leaseId),
    eq(credentials.revision, leased.revision),
    eq(credentials.status, 'active'),
    gt(credentials.leaseExpiresAt, at),
  )
  const [, updated] = await db.batch([
    db.insert(auditLog).select(
      db
        .select({
          seq: sql<null>`${null}`.as('seq'),
          opId: sql<string>`${leaseId}`.as('op_id'),
          at: sql<number>`${at}`.as('at'),
          actorId: sql<null>`${null}`.as('actor_id'),
          action:
            sql<string>`${failure === 'rejected' ? 'credential.needs_reauth' : 'credential.refresh.failed'}`.as(
              'action',
            ),
          targetKind: sql<'system'>`${'system'}`.as('target_kind'),
          targetId: credentials.credentialId,
          detailJson:
            sql<string>`${JSON.stringify({ kind: leased.kind, provider: leased.provider, category: failure })}`.as(
              'detail_json',
            ),
        })
        .from(credentials)
        .where(held),
    ),
    db
      .update(credentials)
      .set({
        ...(failure === 'rejected' ? { status: 'needs_reauth' as const } : {}),
        refreshFailures: sql`${credentials.refreshFailures} + 1`,
        lastRefreshFailureAt: at,
        lastRefreshFailureCategory: failure,
      })
      .where(held)
      .returning(),
  ])
  return updated[0]
}
