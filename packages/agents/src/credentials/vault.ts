/**
 * Encrypted D1 credential storage primitives. Callers authorize operations before entering the vault.
 * No persistence error carries plaintext query parameters.
 *
 * @module
 */
import type { Credential } from '@earendil-works/pi-ai'
import * as v from 'valibot'
import { credentials } from '../../drizzle/management/schema.ts'
import type { ManagementDb } from '../management/db.ts'
import { credentialFingerprint, encryptCredential } from './encryption.ts'
import type { CredentialIdentity } from './encryption.ts'

const oauthSchema = v.looseObject({
  type: v.literal('oauth'),
  // RFC 6749 §5.1 leaves token sizes undefined; Pi requires nonblank opaque strings.
  access: v.pipe(
    v.string(),
    v.check((value) => value.trim().length > 0),
  ),
  refresh: v.pipe(
    v.string(),
    v.check((value) => value.trim().length > 0),
  ),
  expires: v.pipe(v.number(), v.finite()),
})

/** Parse the Pi value for either kind; malformed payload errors never contain the secret. */
export function parseCredential(kind: CredentialIdentity['kind'], secret: string) {
  if (kind === 'api_key') return { type: 'api_key', key: secret } satisfies Credential
  try {
    const parsed = v.safeParse(oauthSchema, JSON.parse(secret))
    if (parsed.success) return parsed.output
  } catch {
    /* JSON parser diagnostics can echo secret input. */
  }
  throw new TypeError('credential_unavailable: invalid credential payload')
}

/** Safe outward metadata, intentionally constructed without spreading a stored row. */
export function credentialMetadata(row: typeof credentials.$inferSelect) {
  return {
    credentialId: row.credentialId,
    kind: row.kind,
    provider: row.provider,
    ownerScope: row.ownerId === null ? ('installation' as const) : ('principal' as const),
    ownerId: row.ownerId,
    status: row.status,
    revision: row.revision,
    fingerprint: row.fingerprint,
    last4: row.last4,
    createdAt: row.createdAt,
    // Preserve the outward shape; usage timestamps were never recorded.
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
  const value = parseCredential(identity.kind, secret)
  const envelope = await encryptCredential(identity, secret, kek)
  const token = value.type === 'api_key' ? value.key : value.access
  return {
    statement: db
      .insert(credentials)
      .values({
        ...identity,
        ...envelope,
        status: 'active',
        fingerprint: await credentialFingerprint(secret, kek),
        last4: token.length >= 16 ? token.slice(-4) : '',
        createdAt: now,
      })
      .returning(),
  }
}
