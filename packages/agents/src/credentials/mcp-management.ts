/** Secret-safe OAuth management facade for the future authenticated UI and local CLI. @module */
import { and, eq, inArray, lt } from 'drizzle-orm'
import * as v from 'valibot'
import { credentials, mcpOAuthTransactions, mcpRequests } from '../../drizzle/management/schema.ts'
import type { ManagementDb } from '../control-plane/db.ts'
import { mcpServer } from '../control-plane/mcp.ts'
import { completeMcpOAuth, configureMcpOAuthClient, startMcpOAuth } from './mcp-oauth.ts'
import { mcpClientDocument, mcpClientSchema, mcpLoopbackRedirect } from './mcp-oauth-http.ts'
import { mcpEndpoint } from '../tools/mcp/transport.ts'
import { eraseMcpSecret, mcpSecretInsert } from './mcp-vault.ts'

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
  const expired = await db
    .select()
    .from(mcpOAuthTransactions)
    .where(
      and(
        inArray(mcpOAuthTransactions.status, ['pending', 'exchanging']),
        lt(mcpOAuthTransactions.expiresAt, now),
      ),
    )
    .limit(100)
  for (const transaction of expired)
    await db.batch([
      db
        .update(mcpOAuthTransactions)
        .set({ status: 'reauth_required' })
        .where(
          and(
            eq(mcpOAuthTransactions.transactionId, transaction.transactionId),
            inArray(mcpOAuthTransactions.status, ['pending', 'exchanging']),
          ),
        ),
      eraseMcpSecret(db, transaction.verifierId, now),
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
      mcpEndpoint(input.registrationEndpoint)
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
      await envelope.statement
      return { credentialId: envelope.credentialId }
    }
    case 'attach': {
      const request = await db
        .select()
        .from(mcpRequests)
        .where(eq(mcpRequests.requestId, input.requestId))
        .get()
      if (!request || request.expiresAt <= Date.now()) throw new Error('mcp_registration_expired')
      return { status: 'completed', requestId: input.requestId, credentialId: input.credentialId }
    }
    case 'begin':
    case 'begin-loopback': {
      if (input.operation === 'begin-loopback') mcpLoopbackRedirect(input.loopbackRedirectUri ?? '')
      else if (input.loopbackRedirectUri !== undefined) throw new Error('mcp_redirect_invalid')
      if (input.requestId) {
        const request = await db
          .select()
          .from(mcpRequests)
          .where(eq(mcpRequests.requestId, input.requestId))
          .get()
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
      const rows = await db
        .select({
          credentialId: credentials.credentialId,
          kind: credentials.kind,
          status: credentials.status,
          expiresAt: credentials.expiresAt,
          authState: credentials.mcpAuthState,
          revision: credentials.revision,
        })
        .from(credentials)
        .where(
          and(
            eq(credentials.provider, input.serverId),
            eq(credentials.purpose, 'mcp_server'),
            inArray(credentials.kind, ['mcp_bearer', 'mcp_oauth']),
          ),
        )
      const transactions = await db
        .select({
          transactionId: mcpOAuthTransactions.transactionId,
          status: mcpOAuthTransactions.status,
          expiresAt: mcpOAuthTransactions.expiresAt,
        })
        .from(mcpOAuthTransactions)
        .where(and(eq(mcpOAuthTransactions.serverId, input.serverId)))
        .limit(100)
      return {
        credentials: rows.map((row) => ({ ...row, expiryKnown: row.expiresAt !== null })),
        transactions,
      }
    }
  }
}
