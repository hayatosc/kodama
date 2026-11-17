/**
 * Data-access repository for encrypted credential envelopes and leases in management D1.
 *
 * @module
 */
import type { ManagementDb } from '../control-plane/db.ts'
import { parseEnum, parseNullableEnum, prepareQuery } from '../lib/reylo.ts'
import { queries } from './queries/index.ts'

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

/** Fetch one credential row by ID, or `undefined` when absent. */
export async function findCredentialById(
  db: ManagementDb,
  credentialId: string,
): Promise<CredentialRow | undefined> {
  const row = await queries.getCredentialById.run(db, { credentialId })
  return row === null ? undefined : parseCredentialRow(row)
}

/** List all model-provider credential rows. */
export async function listProviderCredentials(db: ManagementDb): Promise<CredentialRow[]> {
  return (await queries.listProviderCredentials.run(db)).map(parseCredentialRow)
}

/** Prepare an insert statement for one encrypted model-provider credential row. */
export function insertCredentialStatement(
  db: ManagementDb,
  params: {
    credentialId: string
    kind: string
    purpose: string
    provider: string
    status: string
    revision: number
    ciphertext: string
    iv: string
    wrappedDek: string
    wrapIv: string
    fingerprint: string
    last4: string
    createdAt: number
    expiresAt: number | null
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.insertCredential, params)
}

/** Attempt to claim an exclusive refresh/modification lease on a credential row. */
export async function claimCredentialLease(
  db: ManagementDb,
  params: { leaseId: string; leaseExpiresAt: number; credentialId: string; now: number },
): Promise<CredentialRow | undefined> {
  const row = await queries.updateClaimCredentialLease.run(db, params)
  return row === null ? undefined : parseCredentialRow(row)
}

/** Release a previously claimed lease on `credentialId`. */
export async function releaseCredentialLease(
  db: ManagementDb,
  credentialId: string,
  leaseId: string,
): Promise<void> {
  await queries.updateReleaseCredentialLease.run(db, { credentialId, leaseId })
}

/** Prepare a CAS-guarded statement updating an OAuth credential envelope and expiry. */
export function updateCredentialOAuthStatement(
  db: ManagementDb,
  params: {
    ciphertext: string
    iv: string
    wrappedDek: string
    wrapIv: string
    nextRevision: number
    fingerprint: string
    last4: string
    expiresAt: number
    lastRefreshedAt: number
    credentialId: string
    leaseId: string
    expectedRevision: number
    now: number
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.updateCredentialModifyOauth, params)
}

/** Prepare a CAS-guarded statement updating an API key credential envelope. */
export function updateCredentialApiKeyStatement(
  db: ManagementDb,
  params: {
    ciphertext: string
    iv: string
    wrappedDek: string
    wrapIv: string
    nextRevision: number
    fingerprint: string
    last4: string
    credentialId: string
    leaseId: string
    expectedRevision: number
    now: number
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.updateCredentialModifyApiKey, params)
}

/** Prepare a statement revoking a credential and wiping its encrypted envelope. */
export function revokeCredentialStatement(
  db: ManagementDb,
  credentialId: string,
  revokedAt: number,
): D1PreparedStatement {
  return prepareQuery(db, queries.updateRevokeCredential, { credentialId, revokedAt })
}
