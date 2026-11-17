/**
 * Data-access repository for MCP credential envelopes, grants, and refresh leases in management D1.
 *
 * @module
 */
import type { ManagementDb } from '../../control-plane/db.ts'
import { parseCredentialRow } from '../../credentials/vault.repository.ts'
import type { CredentialRow } from '../../credentials/vault.repository.ts'
import { prepareQuery, runChanges } from '../../lib/reylo.ts'
import { queries } from './queries/index.ts'

/** Prepare an insert statement for an MCP credential envelope. */
export function insertMcpCredentialStatement(
  db: ManagementDb,
  params: {
    credentialId: string
    kind: string
    provider: string
    revision: number
    ciphertext: string
    iv: string
    wrappedDek: string
    wrapIv: string
    fingerprint: string
    createdAt: number
    expiresAt: number | null
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.insertMcpCredential, params)
}

/** Fetch an MCP-purpose credential row scoped to `serverId`, or `undefined`. */
export async function findMcpSecret(
  db: ManagementDb,
  credentialId: string,
  serverId: string,
): Promise<CredentialRow | undefined> {
  const row = await queries.getMcpSecret.run(db, { credentialId, serverId })
  return row === null ? undefined : parseCredentialRow(row)
}

/** Check whether an active working agent holds a live grant for `credentialId`. */
export async function findMcpAgentGrant(db: ManagementDb, agentId: string, credentialId: string) {
  return (await queries.getMcpAgentGrant.run(db, { agentId, credentialId })) ?? undefined
}

/** Prepare a statement erasing encrypted bytes and leases for an MCP secret. */
export function eraseMcpSecretStatement(
  db: ManagementDb,
  credentialId: string,
  now: number,
): D1PreparedStatement {
  return prepareQuery(db, queries.updateEraseMcpSecret, { credentialId, now })
}

/** Immediately erase encrypted bytes and leases for a denied or abandoned MCP secret. */
export async function eraseMcpSecretRow(
  db: ManagementDb,
  credentialId: string,
  now: number,
): Promise<void> {
  await queries.updateEraseMcpSecret.run(db, { credentialId, now })
}

/** Prepare a statement deleting MCP tool assignments referencing `credentialId`. */
export function deleteMcpAssignmentsByCredentialStatement(
  db: ManagementDb,
  credentialId: string,
): D1PreparedStatement {
  return prepareQuery(db, queries.deleteMcpAssignmentsByCredential, { credentialId })
}

/** Prepare a statement deleting credential grants referencing `credentialId`. */
export function deleteCredentialGrantsByCredentialStatement(
  db: ManagementDb,
  credentialId: string,
): D1PreparedStatement {
  return prepareQuery(db, queries.deleteCredentialGrantsByCredential, { credentialId })
}

/** Mark an expired MCP credential lease as stale without replaying refresh. */
export async function markMcpCredentialsStaleLease(
  db: ManagementDb,
  credentialId: string,
  revision: number,
  leaseId: string,
): Promise<void> {
  await queries.updateMarkMcpCredentialsStaleLease.run(db, { credentialId, revision, leaseId })
}

/** Claim an exclusive refresh lease on an active MCP OAuth credential. */
export async function claimMcpCredentialLease(
  db: ManagementDb,
  params: { leaseId: string; leaseExpiresAt: number; credentialId: string; revision: number },
): Promise<number> {
  return runChanges(db, queries.updateClaimMcpCredentialLease, params)
}

/** Persist rotated MCP OAuth ciphertext and advance the revision under lease. */
export async function saveMcpCredentialRefresh(
  db: ManagementDb,
  params: {
    ciphertext: string
    iv: string
    wrappedDek: string
    wrapIv: string
    nextRevision: number
    expiresAt: number | null
    fingerprint: string
    credentialId: string
    revision: number
    leaseId: string
  },
): Promise<number> {
  return runChanges(db, queries.updateSaveMcpCredentialRefresh, params)
}

/** Mark a leased MCP credential as needing re-authentication or re-consent. */
export async function markMcpCredentialNeedsReauth(
  db: ManagementDb,
  params: { reason: string; credentialId: string; revision: number; leaseId: string },
): Promise<void> {
  await queries.updateMarkMcpCredentialNeedsReauth.run(db, params)
}

/** Persist an authentication failure reason observed on a resource request. */
export async function markMcpAuthFailure(
  db: ManagementDb,
  params: { reason: string; credentialId: string; serverId: string; revision: number },
): Promise<void> {
  await queries.updateMarkMcpAuthFailure.run(db, params)
}

/** List credential metadata rows associated with an MCP server. */
export async function listMcpServerCredentials(db: ManagementDb, serverId: string) {
  return queries.listMcpServerCredentials.run(db, { serverId })
}
