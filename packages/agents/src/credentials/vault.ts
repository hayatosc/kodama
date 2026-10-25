/**
 * Encrypted D1 credential storage primitives. Callers authorize operations before entering the vault.
 * No persistence error carries plaintext query parameters.
 *
 * @module
 */
import { credentials } from '../../drizzle/management/schema.ts'
import type { ManagementDb } from '../management/db.ts'
import { sha256Hex } from '../lib/hash.ts'
import { encryptCredential } from './encryption.ts'
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
