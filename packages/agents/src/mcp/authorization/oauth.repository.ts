/**
 * Data-access repository for MCP OAuth client registrations and PKCE transactions in management D1.
 *
 * @module
 */
import type { ManagementDb } from '../../control-plane/db.ts'
import { prepareQuery, runChanges } from '../../lib/reylo.ts'
import { queries } from './queries/index.ts'

/** Fetch a registered MCP OAuth client record by server, issuer, and redirect URI. */
export async function findMcpOAuthClient(
  db: ManagementDb,
  serverId: string,
  issuer: string,
  redirectUri: string,
) {
  return (await queries.getMcpOauthClient.run(db, { serverId, issuer, redirectUri })) ?? undefined
}

/** Prepare an upsert statement for a pre-registered MCP OAuth client. */
export function upsertMcpOAuthClientStatement(
  db: ManagementDb,
  params: {
    registrationId: string
    serverId: string
    issuer: string
    redirectUri: string
    metadataJson: string
    secretId: string | null
    createdAt: number
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.insertMcpOauthClientUpsert, params)
}

/** Persist a placeholder registration row before calling an external DCR endpoint. */
export async function insertMcpOAuthClientRegistering(
  db: ManagementDb,
  params: {
    registrationId: string
    serverId: string
    issuer: string
    redirectUri: string
    createdAt: number
  },
): Promise<void> {
  await queries.insertMcpOauthClientRegistering.run(db, params)
}

/** Prepare a statement marking a dynamic OAuth client registration ready. */
export function updateMcpOAuthClientReadyStatement(
  db: ManagementDb,
  params: { metadataJson: string; secretId: string | null; registrationId: string },
): D1PreparedStatement {
  return prepareQuery(db, queries.updateMcpOauthClientReady, params)
}

/** Mark an in-flight dynamic client registration as failed. */
export async function markMcpOAuthClientFailed(
  db: ManagementDb,
  registrationId: string,
): Promise<void> {
  await queries.updateMcpOauthClientFailed.run(db, { registrationId })
}

/** Prepare an insert statement for a single-use PKCE authorization transaction. */
export function insertMcpOAuthTransactionStatement(
  db: ManagementDb,
  params: {
    requestId: string | null
    transactionId: string
    serverId: string
    serverRevision: number
    stateDigest: string
    browserDigest: string
    bindingJson: string
    verifierId: string
    expiresAt: number
    createdAt: number
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.insertMcpOauthTransaction, params)
}

/** Fetch an unexpired pending PKCE transaction matching state and browser nonce digests. */
export async function findPendingMcpOAuthTransaction(
  db: ManagementDb,
  stateDigest: string,
  browserDigest: string,
  now: number,
) {
  return (
    (await queries.getMcpOauthTransactionPending.run(db, { stateDigest, browserDigest, now })) ??
    undefined
  )
}

/** Atomically claim a pending OAuth callback transaction once. */
export async function claimMcpOAuthTransaction(
  db: ManagementDb,
  transactionId: string,
  status: string,
): Promise<number> {
  return runChanges(db, queries.updateClaimMcpOauthTransaction, { status, transactionId })
}

/** Prepare a statement marking a PKCE transaction completed with its issued credential ID. */
export function completeMcpOAuthTransactionStatement(
  db: ManagementDb,
  credentialId: string,
  transactionId: string,
): D1PreparedStatement {
  return prepareQuery(db, queries.updateCompleteMcpOauthTransaction, {
    credentialId,
    transactionId,
  })
}

/** Prepare a statement marking a PKCE transaction failed. */
export function failMcpOAuthTransactionStatement(
  db: ManagementDb,
  transactionId: string,
): D1PreparedStatement {
  return prepareQuery(db, queries.updateFailMcpOauthTransaction, { transactionId })
}

/** List all expired pending OAuth transactions as of `now`. */
export async function listExpiredMcpOAuthTransactions(db: ManagementDb, now: number) {
  return queries.listExpiredMcpOauthTransactions.run(db, { now })
}

/** Prepare a statement marking an expired OAuth transaction as expired. */
export function expireMcpOAuthTransactionStatement(
  db: ManagementDb,
  transactionId: string,
): D1PreparedStatement {
  return prepareQuery(db, queries.updateExpireMcpOauthTransaction, { transactionId })
}

/** List OAuth transactions associated with `serverId`. */
export async function listMcpOAuthTransactionsByServer(db: ManagementDb, serverId: string) {
  return queries.listMcpOauthTransactionsByServer.run(db, { serverId })
}

/** Attach an issued credential ID to an active owner-auth MCP registration request. */
export async function attachMcpRequest(
  db: ManagementDb,
  credentialId: string,
  requestId: string,
  now: number,
): Promise<number> {
  return runChanges(db, queries.updateAttachMcpRequest, { credentialId, requestId, now })
}
