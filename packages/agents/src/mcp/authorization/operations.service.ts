/** Secret-safe OAuth management facade for the future authenticated UI and local CLI. @module */
import * as v from 'valibot'
import type { ManagementDb } from '../../control-plane/db.ts'
import { runBatch } from '../../lib/reylo.ts'
import { mcpEndpoint } from '../connection/transport.ts'
import { mcpServer } from '../registration/catalog.service.ts'
import { findMcpRequestById } from '../registration/requests.repository.ts'
import {
  mcpClientDocument,
  mcpClientSchema,
  mcpLoopbackRedirect,
  mcpOAuthEndpoint,
} from './oauth-http.ts'
import {
  attachMcpRequest,
  expireMcpOAuthTransactionStatement,
  listExpiredMcpOAuthTransactions,
  listMcpOAuthTransactionsByServer,
} from './oauth.repository.ts'
import { completeMcpOAuth, configureMcpOAuthClient, startMcpOAuth } from './oauth.service.ts'
import { listMcpServerCredentials } from './vault.repository.ts'
import { eraseMcpSecretStatement, mcpSecretInsert, mcpToken } from './vault.service.ts'

const id = v.pipe(v.string(), v.uuid())
const nonce = v.pipe(v.string(), v.minLength(32), v.maxLength(256))
const schema = v.variant('operation', [
  v.strictObject({
    operation: v.picklist(['begin', 'begin-loopback']),
    loopbackRedirectUri: v.optional(v.string()),
    requestId: v.optional(id),
    serverId: id,
    browserNonce: nonce,
    issuer: v.optional(v.string()),
    scope: v.optional(v.pipe(v.string(), v.maxLength(2_048))),
    initialTokenId: v.optional(id),
  }),
  v.strictObject({
    operation: v.picklist(['complete', 'complete-loopback']),
    loopbackRedirectUri: v.optional(v.string()),
    state: nonce,
    browserNonce: nonce,
    code: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(8_192))),
    issuer: v.optional(v.string()),
    denied: v.optional(v.boolean()),
  }),
  v.strictObject({
    operation: v.picklist(['client', 'client-loopback']),
    serverId: id,
    client: mcpClientSchema,
    secret: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(16_384))),
  }),
  v.strictObject({ operation: v.literal('status'), serverId: id }),
  v.strictObject({ operation: v.literal('metadata') }),
  v.strictObject({
    operation: v.literal('initial-token'),
    serverId: id,
    issuer: v.string(),
    registrationEndpoint: v.string(),
    secret: v.pipe(v.string(), v.minLength(1), v.maxLength(16_384)),
  }),
  v.strictObject({ operation: v.literal('attach'), requestId: id, credentialId: id }),
])

/** Recover only expired transactions; an uncertain code exchange is never retried. */
export async function recoverMcpOAuth(db: ManagementDb, now = Date.now()) {
  const expired = await listExpiredMcpOAuthTransactions(db, now)
  for (const transaction of expired)
    await runBatch(db, [
      expireMcpOAuthTransactionStatement(db, transaction.transactionId),
      eraseMcpSecretStatement(db, transaction.verifierId, now),
    ])
}

/** Private management supplies a server-side browser nonce; models cannot invoke this facade. */
export async function manageMcpOAuth(
  db: ManagementDb,
  kek: string,
  origin: string,
  value: unknown,
): Promise<unknown> {
  const input = v.parse(schema, value)
  await recoverMcpOAuth(db)
  switch (input.operation) {
    case 'metadata':
      return mcpClientDocument(origin)
    case 'initial-token': {
      mcpEndpoint(input.issuer)
      mcpOAuthEndpoint(input.registrationEndpoint)
      const envelope = await mcpSecretInsert(
        db,
        kek,
        input.serverId,
        'mcp_client',
        JSON.stringify({
          kind: 'initial',
          issuer: input.issuer,
          endpoint: input.registrationEndpoint,
          secret: input.secret,
        }),
        Date.now(),
      )
      await envelope.statement.run()
      return { credentialId: envelope.credentialId }
    }
    case 'attach': {
      const request = await findMcpRequestById(db, input.requestId)
      if (
        !request?.serverId ||
        request.expiresAt <= Date.now() ||
        request.status !== 'awaiting_owner_auth'
      )
        throw new Error('mcp_registration_expired')
      const { server } = await mcpToken(db, kek, request.serverId, input.credentialId)
      if (server.revision !== request.serverRevision) throw new Error('mcp_registration_changed')
      // Persist consumed attachment permission before the service attempts discovery.
      const attachedChanges = await attachMcpRequest(
        db,
        input.credentialId,
        request.requestId,
        Date.now(),
      )
      if (attachedChanges === 0) throw new Error('mcp_registration_expired')
      return { status: 'completed', requestId: input.requestId, credentialId: input.credentialId }
    }
    case 'begin':
    case 'begin-loopback': {
      if (input.operation === 'begin-loopback') mcpLoopbackRedirect(input.loopbackRedirectUri ?? '')
      else if (input.loopbackRedirectUri !== undefined) throw new Error('mcp_redirect_invalid')
      if (input.requestId) {
        const request = await findMcpRequestById(db, input.requestId)
        const server = await mcpServer(db, input.serverId)
        if (
          !request ||
          request.serverId !== server.serverId ||
          request.serverRevision !== server.revision ||
          request.expiresAt <= Date.now() ||
          request.status !== 'awaiting_owner_auth'
        )
          throw new Error('mcp_registration_expired')
      }
      return startMcpOAuth(
        db,
        kek,
        origin,
        input.serverId,
        input.browserNonce,
        input.issuer,
        input.scope,
        input.initialTokenId,
        Date.now(),
        input.requestId,
        input.loopbackRedirectUri,
      )
    }
    case 'complete':
    case 'complete-loopback': {
      if (input.operation === 'complete-loopback')
        mcpLoopbackRedirect(input.loopbackRedirectUri ?? '')
      else if (input.loopbackRedirectUri !== undefined) throw new Error('mcp_redirect_invalid')
      return completeMcpOAuth(db, kek, origin, {
        state: input.state,
        browserNonce: input.browserNonce,
        code: input.code,
        issuer: input.issuer,
        denied: input.denied,
        loopbackRedirectUri: input.loopbackRedirectUri,
      })
    }
    case 'client':
    case 'client-loopback': {
      if (input.operation === 'client-loopback') mcpLoopbackRedirect(input.client.redirectUri)
      else if (input.client.redirectUri !== mcpClientDocument(origin).redirect_uris[0])
        throw new Error('mcp_redirect_invalid')
      return configureMcpOAuthClient(db, kek, input.serverId, input.client, input.secret)
    }
    case 'status': {
      await mcpServer(db, input.serverId)
      const rows = await listMcpServerCredentials(db, input.serverId)
      const transactions = await listMcpOAuthTransactionsByServer(db, input.serverId)
      return {
        credentials: rows.map((row) => ({ ...row, expiryKnown: row.expiresAt !== null })),
        transactions,
      }
    }
  }
}
