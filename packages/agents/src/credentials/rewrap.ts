/** Explicit KEK replacement without decrypting provider secrets or resolving old keys. @module */
import { and, eq, gt, isNull, lt, or, count } from 'drizzle-orm'
import { credentials, systemSettings } from '../../drizzle/management/schema.ts'
import type { ManagementCall } from '../management/service/agents.ts'
import { auditStatement } from '../management/audit.ts'
import { uuidv7 } from '../lib/uuid.ts'
import * as v from 'valibot'
import { sha256Hex } from '../lib/hash.ts'
import { credentialActor } from './management.ts'
import { rewrapCredential } from './encryption.ts'
import { KEK_VERSION_KEY, KEK_FINGERPRINT_KEY, guardKekVersion, kekFor } from './keys.ts'
import type { KekEnv } from './keys.ts'
import { invalidateCredential } from './invalidation.ts'

const inputSchema = v.strictObject({
  previousKek: v.string(),
  previousVersion: v.pipe(v.number(), v.integer(), v.minValue(1)),
})

/** The previous key is write-only maintenance input; the Worker binds only the new key. */
export async function rewrapCredentials(call: ManagementCall, env: KekEnv, request: unknown) {
  const principal = credentialActor(call)
  const parsed = v.safeParse(inputSchema, request)
  if (!parsed.success) throw new TypeError('Invalid KEK replacement')
  const { previousKek, previousVersion } = parsed.output
  const version = previousVersion + 1
  const nextKek = kekFor(env)
  const fingerprint = JSON.stringify(await sha256Hex(nextKek))
  const rowsBefore = await call.db.select().from(systemSettings)
  const currentVersion = Number(rowsBefore.find((row) => row.key === KEK_VERSION_KEY)?.valueJson)
  const currentFingerprint = rowsBefore.find((row) => row.key === KEK_FINGERPRINT_KEY)?.valueJson
  if (
    nextKek === previousKek ||
    !(
      (currentVersion === previousVersion &&
        currentFingerprint === JSON.stringify(await sha256Hex(previousKek))) ||
      (currentVersion === version && currentFingerprint === fingerprint)
    )
  )
    throw new Error('credential_unavailable: invalid KEK replacement generation')
  await call.db.batch([
    guardKekVersion(call.db, currentVersion),
    call.db
      .update(systemSettings)
      .set({ valueJson: fingerprint })
      .where(eq(systemSettings.key, KEK_FINGERPRINT_KEY)),
    call.db
      .insert(systemSettings)
      .values({ key: KEK_VERSION_KEY, valueJson: String(version) })
      .onConflictDoUpdate({ target: systemSettings.key, set: { valueJson: String(version) } }),
    auditStatement(call.db, {
      opId: `credential.kek.start:${version}`,
      at: call.now,
      actorId: principal.principalId,
      action: 'credential.kek.start',
      targetKind: 'system',
      targetId: String(version),
      detail: { previousVersion, version },
    }).onConflictDoNothing(),
  ])
  const rows = await call.db
    .select()
    .from(credentials)
    .where(eq(credentials.kekVersion, previousVersion))
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
          eq(credentials.kekVersion, previousVersion),
          or(isNull(credentials.leaseId), lt(credentials.leaseExpiresAt, Date.now())),
        ),
      )
      .returning()
      .get()
    if (!leased) continue
    try {
      const envelope =
        leased.status === 'revoked'
          ? { kekVersion: version }
          : await rewrapCredential(
              leased,
              {
                ciphertext: leased.ciphertext ?? '',
                iv: leased.iv ?? '',
                wrappedDek: leased.wrappedDek ?? '',
                wrapIv: leased.wrapIv ?? '',
                kekVersion: leased.kekVersion,
              },
              previousKek,
              nextKek,
              version,
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
            version,
          },
        }),
      ])
      if (updated.length) rewrapped += 1
      await invalidateCredential(call, row.credentialId)
    } catch {
      throw new Error('credential_unavailable: KEK rewrap failed; retry the same replacement')
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
    .where(eq(credentials.kekVersion, previousVersion))
    .get()
  const remaining = result?.remaining ?? 0
  if (!remaining)
    await auditStatement(call.db, {
      opId: `credential.kek.complete:${version}`,
      at: Date.now(),
      actorId: principal.principalId,
      action: 'credential.kek.complete',
      targetKind: 'system',
      targetId: String(version),
      detail: { version },
    }).onConflictDoNothing()
  return { version, rewrapped, remaining, complete: remaining === 0 }
}
