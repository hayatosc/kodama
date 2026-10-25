/**
 * Encrypted D1 credential storage primitives. Callers authorize operations before entering the vault.
 * No persistence error carries plaintext query parameters.
 *
 * @module
 */
import { eq } from 'drizzle-orm'
import { credentials } from '../../drizzle/management/schema.ts'
import type { ManagementDb } from '../management/db.ts'
import { sha256Hex } from '../lib/hash.ts'
import { encryptCredential, decryptCredential } from './encryption.ts'
import type { CredentialIdentity } from './encryption.ts'

/** Safe outward metadata, intentionally constructed without spreading a stored row. */
export function credentialMetadata(row: typeof credentials.$inferSelect) {
  return {
    credentialId: row.credentialId,
    kind: row.kind,
    provider: row.provider,
    ownerScope: row.ownerScope,
    ownerId: row.ownerId,
    status: row.status,
    revision: row.revision,
    kekVersion: row.kekVersion,
    fingerprint: row.fingerprint,
    last4: row.last4,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  }
}

/** Prepare an encrypted insert for the caller's atomic mutation and audit batch. */
export async function credentialInsert(
  db: ManagementDb,
  identity: CredentialIdentity,
  secret: string,
  kek: string,
  now: number,
) {
  if (secret.length < 8 || secret.length > 16384) throw new TypeError('Invalid credential length')
  const envelope = await encryptCredential(identity, secret, kek)
  return {
    statement: db
      .insert(credentials)
      .values({
        ...identity,
        ...envelope,
        status: 'active',
        fingerprint: await sha256Hex(secret),
        last4: secret.slice(-4),
        createdAt: now,
      })
      .returning(),
  }
}

/** Retrieve only usable ciphertext and fail closed without leaking database or crypto errors. */
export async function readCredential(db: ManagementDb, credentialId: string, kek: string) {
  try {
    const row = await db
      .select()
      .from(credentials)
      .where(eq(credentials.credentialId, credentialId))
      .get()
    if (
      !row ||
      (row.status !== 'active' && row.status !== 'retiring') ||
      row.ciphertext === null ||
      row.iv === null ||
      row.wrappedDek === null ||
      row.wrapIv === null ||
      row.kekVersion !== 1
    ) {
      throw new Error('unavailable')
    }
    return await decryptCredential(
      row,
      {
        ciphertext: row.ciphertext,
        iv: row.iv,
        wrappedDek: row.wrappedDek,
        wrapIv: row.wrapIv,
        kekVersion: row.kekVersion,
      },
      kek,
    )
  } catch {
    throw new Error('credential_unavailable: credential cannot be read')
  }
}
