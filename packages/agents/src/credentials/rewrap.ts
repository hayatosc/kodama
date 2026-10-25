/** Resumable, lease-protected V1-to-V2 rewrapping without decrypting provider secrets. @module */
import { and, eq, gt, isNull, lt, or, count } from 'drizzle-orm'
import { credentials, systemSettings } from '../../drizzle/management/schema.ts'
import type { ManagementCall } from '../management/service/agents.ts'
import { auditStatement } from '../management/audit.ts'
import { uuidv7 } from '../lib/uuid.ts'
import { requireCredentialOwner } from './management.ts'
import { rewrapCredential } from './encryption.ts'
import { KEK_VERSION_KEY, kekFor } from './keys.ts'
import type { KekEnv } from './keys.ts'
import { invalidateCredential } from './invalidation.ts'

/** Switch new writes first, then rewrap at most 100 rows. Retry until remaining is zero. */
export async function rewrapCredentials(call: ManagementCall, env: KekEnv) {
  const principal = requireCredentialOwner(call)
  const nextKek = kekFor(env, 2)
  await call.db.batch([
    call.db
      .insert(systemSettings)
      .values({ key: KEK_VERSION_KEY, valueJson: '2' })
      .onConflictDoUpdate({ target: systemSettings.key, set: { valueJson: '2' } }),
    auditStatement(call.db, {
      opId: 'credential.kek.start:2',
      at: call.now,
      actorId: principal.principalId,
      action: 'credential.kek.start',
      targetKind: 'system',
      targetId: '2',
      detail: { previousVersion: 1, version: 2 },
    }).onConflictDoNothing(),
  ])
  const rows = await call.db
    .select()
    .from(credentials)
    .where(eq(credentials.kekVersion, 1))
    .limit(100)
  let rewrapped = 0
  for (const row of rows) {
    const leaseId = uuidv7()
    const leased = await call.db
      .update(credentials)
      .set({ leaseId, leaseExpiresAt: Date.now() + 30_000 })
      .where(
        and(
          eq(credentials.credentialId, row.credentialId),
          eq(credentials.kekVersion, 1),
          or(isNull(credentials.leaseId), lt(credentials.leaseExpiresAt, Date.now())),
        ),
      )
      .returning()
      .get()
    if (!leased) continue
    try {
      const envelope =
        leased.status === 'revoked'
          ? { kekVersion: 2 }
          : await rewrapCredential(
              leased,
              {
                ciphertext: leased.ciphertext ?? '',
                iv: leased.iv ?? '',
                wrappedDek: leased.wrappedDek ?? '',
                wrapIv: leased.wrapIv ?? '',
                kekVersion: leased.kekVersion,
              },
              kekFor(env, 1),
              nextKek,
              2,
            )
      const [updated] = await call.db.batch([
        call.db
          .update(credentials)
          .set(envelope)
          .where(
            and(
              eq(credentials.credentialId, leased.credentialId),
              eq(credentials.revision, leased.revision),
              eq(credentials.leaseId, leaseId),
              eq(credentials.status, leased.status),
              gt(credentials.leaseExpiresAt, Date.now()),
            ),
          )
          .returning(),
        auditStatement(call.db, {
          opId: leaseId,
          at: Date.now(),
          actorId: principal.principalId,
          action: 'credential.kek.rewrap.attempt',
          targetKind: 'system',
          targetId: row.credentialId,
          detail: {
            kind: row.kind,
            provider: row.provider,
            fingerprint: row.fingerprint,
            version: 2,
          },
        }),
      ])
      if (updated.length) rewrapped += 1
      await invalidateCredential(call, row.credentialId)
    } catch {
      throw new Error('credential_unavailable: KEK rewrap failed; retain both KEKs and retry')
    } finally {
      await call.db
        .update(credentials)
        .set({ leaseId: null, leaseExpiresAt: null })
        .where(
          and(eq(credentials.credentialId, row.credentialId), eq(credentials.leaseId, leaseId)),
        )
    }
  }
  const result = await call.db
    .select({ remaining: count() })
    .from(credentials)
    .where(eq(credentials.kekVersion, 1))
    .get()
  const remaining = result?.remaining ?? 0
  if (!remaining)
    await auditStatement(call.db, {
      opId: 'credential.kek.complete:2',
      at: Date.now(),
      actorId: principal.principalId,
      action: 'credential.kek.complete',
      targetKind: 'system',
      targetId: '2',
      detail: { version: 2 },
    }).onConflictDoNothing()
  return { version: 2, rewrapped, remaining, complete: remaining === 0 }
}
