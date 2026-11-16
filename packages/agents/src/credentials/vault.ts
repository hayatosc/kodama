/**
 * Encrypted D1 credential storage primitives. Callers authorize operations before entering the vault.
 * No persistence error carries plaintext query parameters.
 *
 * @module
 */
import type { Credential } from '@earendil-works/pi-ai'
import * as v from 'valibot'
import type { ManagementDb } from '../control-plane/db.ts'
import { parseEnum, parseNullableEnum, prepareQuery } from '../lib/reylo.ts'
import { credentialFingerprint, encryptCredential } from './encryption.ts'
import type { CredentialIdentity } from './encryption.ts'
import insertCredential from './sql/insert-credential.sql'

/** Allowed credential kinds stored in `credentials`. */
export const CREDENTIAL_KINDS = [
  'api_key',
  'oauth_subscription',
  'mcp_bearer',
  'mcp_oauth',
  'mcp_client',
  'mcp_transaction',
] as const
/** Credential purposes isolating model providers from MCP servers. */
export const CREDENTIAL_PURPOSES = ['model_provider', 'mcp_server'] as const
/** Lifecycle statuses of stored credentials. */
export const CREDENTIAL_STATUSES = ['active', 'revoked', 'needs_reauth'] as const
/** Auth states recorded on MCP credentials requiring owner intervention. */
export const MCP_AUTH_STATES = ['reauth_required', 'scope_required', 'outcome_unknown'] as const
/** Classification of OAuth refresh failures. */
export const REFRESH_FAILURE_CATEGORIES = ['rejected', 'transient', 'malformed', 'failed'] as const

/** Full row shape from `credentials` with narrowed enum columns. */
export interface CredentialRow {
  credentialId: string
  kind: (typeof CREDENTIAL_KINDS)[number]
  purpose: (typeof CREDENTIAL_PURPOSES)[number]
  provider: string
  status: (typeof CREDENTIAL_STATUSES)[number]
  mcpAuthState: (typeof MCP_AUTH_STATES)[number] | null
  revision: number
  ciphertext: string | null
  iv: string | null
  wrappedDek: string | null
  wrapIv: string | null
  fingerprint: string
  last4: string
  leaseId: string | null
  leaseExpiresAt: number | null
  createdAt: number
  revokedAt: number | null
  lastUsedAt: number | null
  expiresAt: number | null
  lastRefreshedAt: number | null
  refreshFailures: number
  lastRefreshFailureAt: number | null
  lastRefreshFailureCategory: (typeof REFRESH_FAILURE_CATEGORIES)[number] | null
}

/** Narrow a raw SQL credential row into a {@link CredentialRow}. */
export function parseCredentialRow(row: {
  credentialId: string
  kind: string
  purpose: string
  provider: string
  status: string
  mcpAuthState: string | null
  revision: number
  ciphertext: string | null
  iv: string | null
  wrappedDek: string | null
  wrapIv: string | null
  fingerprint: string
  last4: string
  leaseId: string | null
  leaseExpiresAt: number | null
  createdAt: number
  revokedAt: number | null
  lastUsedAt: number | null
  expiresAt: number | null
  lastRefreshedAt: number | null
  refreshFailures: number
  lastRefreshFailureAt: number | null
  lastRefreshFailureCategory: string | null
}): CredentialRow {
  return {
    ...row,
    kind: parseEnum(CREDENTIAL_KINDS, row.kind, 'credential kind'),
    purpose: parseEnum(CREDENTIAL_PURPOSES, row.purpose, 'credential purpose'),
    status: parseEnum(CREDENTIAL_STATUSES, row.status, 'credential status'),
    mcpAuthState: parseNullableEnum(MCP_AUTH_STATES, row.mcpAuthState, 'mcp auth state'),
    lastRefreshFailureCategory: parseNullableEnum(
      REFRESH_FAILURE_CATEGORIES,
      row.lastRefreshFailureCategory,
      'refresh failure category',
    ),
  }
}

const oauthSchema = v.looseObject({
  type: v.literal('oauth'),
  // Owner policy: opaque tokens contain at least eight non-padding characters.
  access: v.pipe(
    v.string(),
    v.check((value) => value.trim().length >= 8),
  ),
  refresh: v.pipe(
    v.string(),
    v.check((value) => value.trim().length >= 8),
  ),
  expires: v.pipe(v.number(), v.finite()),
})

/** Parse the Pi value for either kind; malformed payload errors never contain the secret. */
export function parseCredential(kind: CredentialIdentity['kind'], secret: string) {
  if (kind === 'api_key') return { type: 'api_key', key: secret } satisfies Credential
  if (kind !== 'oauth_subscription') throw new TypeError('credential_unavailable: wrong purpose')
  try {
    const parsed = v.safeParse(oauthSchema, JSON.parse(secret))
    if (parsed.success) return parsed.output
  } catch {
    /* JSON parser diagnostics can echo secret input. */
  }
  throw new TypeError('credential_unavailable: invalid credential payload')
}

/** Safe outward metadata, intentionally constructed without spreading a stored row. */
export function credentialMetadata(row: CredentialRow) {
  return {
    credentialId: row.credentialId,
    kind: row.kind,
    provider: row.provider,
    status: row.status,
    revision: row.revision,
    fingerprint: row.fingerprint,
    last4: row.last4,
    createdAt: row.createdAt,
    // Latest observed selection start from ingestion, not proof of an accepted or billed call.
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    lastRefreshedAt: row.lastRefreshedAt,
    refreshFailures: row.refreshFailures,
    lastRefreshFailureAt: row.lastRefreshFailureAt,
    lastRefreshFailureCategory: row.lastRefreshFailureCategory,
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
    statement: prepareQuery(db, insertCredential, {
      credentialId: identity.credentialId,
      kind: identity.kind,
      purpose: 'model_provider',
      provider: identity.provider,
      status: 'active',
      revision: identity.revision,
      ciphertext: envelope.ciphertext,
      iv: envelope.iv,
      wrappedDek: envelope.wrappedDek,
      wrapIv: envelope.wrapIv,
      fingerprint: await credentialFingerprint(secret, kek),
      last4: token.length >= 16 ? token.slice(-4) : '',
      createdAt: now,
      expiresAt: value.type === 'oauth' ? value.expires : null,
    }),
  }
}
