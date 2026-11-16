/** Cross-object refresh fencing and local-first MCP disconnection.
 * Expired refresh leases mean an unknown rotation outcome, never permission to replay.
 * @module
 */
import { auditStatement } from '../../control-plane/audit.ts'
import type { ManagementDb } from '../../control-plane/db.ts'
import { credentialFingerprint, encryptCredential } from '../../credentials/encryption.ts'
import { parseCredentialRow } from '../../credentials/vault.ts'
import { prepareQuery, runBatch, runChanges } from '../../lib/reylo.ts'
import { exchangeMcpToken, mcpClientAuthentication } from './oauth-http.ts'
import claimMcpCredentialLease from './sql/claim-mcp-credential-lease.sql'
import deleteCredentialGrantsByCredential from './sql/delete-credential-grants-by-credential.sql'
import deleteMcpAssignmentsByCredential from './sql/delete-mcp-assignments-by-credential.sql'
import markMcpAuthFailure from './sql/mark-mcp-auth-failure.sql'
import markMcpCredentialNeedsReauth from './sql/mark-mcp-credential-needs-reauth.sql'
import markMcpCredentialsStaleLease from './sql/mark-mcp-credentials-stale-lease.sql'
import saveMcpCredentialRefresh from './sql/save-mcp-credential-refresh.sql'
import selectMcpSecret from './sql/select-mcp-secret.sql'
import { eraseMcpSecretStatement, mcpAgentGrant, mcpClientSecret, mcpToken } from './vault.ts'

async function waitForRefresh(signal: AbortSignal) {
  signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(new Error('mcp_interrupted'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, 25)
    signal.addEventListener('abort', abort, { once: true })
  })
  signal.throwIfAborted()
}

/** Release a bearer only after live binding, grant, expiry, and refresh checks. */
export async function authorizeMcp(
  db: ManagementDb,
  kek: string,
  serverId: string,
  credentialId: string,
  endpoint: string,
  signal: AbortSignal,
  agentId?: string,
): Promise<{ access: string; revision: number }> {
  signal.throwIfAborted()
  if (agentId) await mcpAgentGrant(db, agentId, credentialId)
  const stored = await mcpToken(db, kek, serverId, credentialId)
  if (endpoint !== stored.value.endpoint) throw new Error('mcp_auth_binding_changed')
  const { row, value } = stored
  const now = Date.now()
  if (row.leaseId) {
    if (row.leaseExpiresAt === null || row.leaseExpiresAt <= now) {
      await markMcpCredentialsStaleLease.run(db, {
        credentialId,
        revision: row.revision,
        leaseId: row.leaseId,
      })
      throw new Error('mcp_reauth_required')
    }
    await waitForRefresh(signal)
    return authorizeMcp(db, kek, serverId, credentialId, endpoint, signal, agentId)
  }
  if (value.expiresAt === null || value.expiresAt > now + 30_000)
    return { access: value.access, revision: row.revision }
  if (value.kind !== 'mcp_oauth' || !value.refresh) throw new Error('mcp_reauth_required')
  const leaseId = crypto.randomUUID()
  const claimedChanges = await runChanges(db, claimMcpCredentialLease, {
    leaseId,
    leaseExpiresAt: now + 30_000,
    credentialId,
    revision: row.revision,
  })
  if (claimedChanges === 0) {
    await waitForRefresh(signal)
    return authorizeMcp(db, kek, serverId, credentialId, endpoint, signal, agentId)
  }
  try {
    const secret = await mcpClientSecret(db, kek, serverId, value.clientSecretId, value.client)
    signal.throwIfAborted()
    const tokens = await exchangeMcpToken(
      value.tokenEndpoint,
      value.client,
      secret,
      { grant_type: 'refresh_token', refresh_token: value.refresh, resource: value.resource },
      AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    )
    if (
      tokens.scope &&
      tokens.scope.split(/\s+/u).some((scope) => !value.scope.split(/\s+/u).includes(scope))
    )
      throw new Error('mcp_scope_required')
    const updated = {
      ...value,
      access: tokens.access_token,
      refresh: tokens.refresh_token ?? value.refresh,
      expiresAt: tokens.expires_in === undefined ? null : Date.now() + tokens.expires_in * 1_000,
      scope: tokens.scope ?? value.scope,
    }
    const plaintext = JSON.stringify(updated)
    const encrypted = await encryptCredential(
      { ...row, revision: row.revision + 1 },
      plaintext,
      kek,
    )
    const savedChanges = await runChanges(db, saveMcpCredentialRefresh, {
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      wrappedDek: encrypted.wrappedDek,
      wrapIv: encrypted.wrapIv,
      nextRevision: row.revision + 1,
      expiresAt: updated.expiresAt,
      fingerprint: await credentialFingerprint(plaintext, kek),
      credentialId,
      revision: row.revision,
      leaseId,
    })
    if (savedChanges === 0) throw new Error('mcp_reauth_required')
    // Reread the live grant and server binding after the external exchange, before sending anything.
    if (agentId) await mcpAgentGrant(db, agentId, credentialId)
    const current = await mcpToken(db, kek, serverId, credentialId)
    signal.throwIfAborted()
    return { access: current.value.access, revision: current.row.revision }
  } catch (error) {
    if (error instanceof Error && error.message === 'mcp_assignment_revoked') throw error
    const reason =
      error instanceof Error && error.message === 'mcp_scope_required'
        ? 'scope_required'
        : error instanceof Error && error.message === 'mcp_auth_outcome_unknown'
          ? 'outcome_unknown'
          : 'reauth_required'
    await markMcpCredentialNeedsReauth.run(db, {
      reason,
      credentialId,
      revision: row.revision,
      leaseId,
    })
    throw new Error('mcp_reauth_required')
  }
}

/** A failed resource request never triggers consent or replay; persist only its safe auth classification. */
export async function markMcpAuthenticationFailure(
  db: ManagementDb,
  serverId: string,
  credentialId: string,
  failure: string,
  revision: number,
) {
  if (failure !== 'mcp_auth_required' && failure !== 'mcp_scope_required') return
  await markMcpAuthFailure.run(db, {
    reason: failure === 'mcp_scope_required' ? 'scope_required' : 'reauth_required',
    credentialId,
    serverId,
    revision,
  })
}

/** Revoke locally first. External revocation is best-effort and cannot restore a local grant. */
export async function disconnectMcp(
  db: ManagementDb,
  kek: string,
  serverId: string,
  credentialId: string,
  now = Date.now(),
) {
  // A stale server revision still permits the operator to destroy the envelope.
  const rawRow = await selectMcpSecret.run(db, { credentialId, serverId })
  const row = rawRow ? parseCredentialRow(rawRow) : undefined
  if (!row || (row.kind !== 'mcp_bearer' && row.kind !== 'mcp_oauth'))
    throw new Error('mcp_credential_unavailable')
  if (row.status === 'revoked')
    return { status: 'revoked' as const, externalRevocation: 'unavailable' as const }
  let active: Awaited<ReturnType<typeof mcpToken>> | undefined
  try {
    active = await mcpToken(db, kek, serverId, credentialId)
  } catch {
    /* Local revocation must still proceed. */
  }
  await runBatch(db, [
    eraseMcpSecretStatement(db, row.credentialId, now),
    prepareQuery(db, deleteMcpAssignmentsByCredential, { credentialId }),
    prepareQuery(db, deleteCredentialGrantsByCredential, { credentialId }),
    auditStatement(db, {
      opId: `mcp.disconnect:${credentialId}:${row.revision}`,
      at: now,
      source: 'operator',
      action: 'mcp.disconnect',
      targetKind: 'system',
      targetId: serverId,
      detail: { credentialId },
    }),
  ])
  let externalRevocation: 'unavailable' | 'succeeded' | 'failed' = 'unavailable'
  const value = active?.value
  if (value?.kind === 'mcp_oauth' && value.revocationEndpoint) {
    try {
      const secret = await mcpClientSecret(db, kek, serverId, value.clientSecretId, value.client)
      const { body, headers } = mcpClientAuthentication(value.client, secret)
      body.set('token', value.refresh ?? value.access)
      body.set('token_type_hint', value.refresh ? 'refresh_token' : 'access_token')
      const response = await fetch(value.revocationEndpoint, {
        method: 'POST',
        redirect: 'error',
        headers,
        body,
        signal: AbortSignal.timeout(5_000),
      })
      externalRevocation = response.ok ? 'succeeded' : 'failed'
      await response.body?.cancel().catch(() => undefined)
    } catch {
      externalRevocation = 'failed'
    }
  }
  return { status: 'revoked' as const, externalRevocation }
}
