/** Single-use OAuth transactions bound to browser, server revision, issuer and client.
 * The future authenticated UI is only a pass-through; it must supply its session nonce.
 * @module
 */
import { and, eq, gt } from 'drizzle-orm'
import * as v from 'valibot'
import { mcpOAuthTransactions, mcpOAuthClients } from '../../../drizzle/management/schema.ts'
import type { ManagementDb } from '../../control-plane/db.ts'
import { mcpServer } from '../registration/catalog.ts'
import { auditStatement } from '../../control-plane/audit.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import {
  eraseMcpSecret,
  mcpSecret,
  mcpSecretInsert,
  mcpClientSecret,
  mcpClientSecretPayload,
} from './vault.ts'
import {
  discoverMcpOAuth,
  exchangeMcpToken,
  mcpLoopbackRedirect,
  mcpClientDocument,
  mcpClientSchema,
  registerMcpOAuthClient,
} from './oauth-http.ts'

function randomSecret() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

async function digest(value: string) {
  return btoa(
    String.fromCharCode(
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    ),
  )
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

const bindingSchema = v.strictObject({
  endpoint: v.string(),
  resource: v.string(),
  issuer: v.string(),
  authorizationEndpoint: v.string(),
  tokenEndpoint: v.string(),
  revocationEndpoint: v.optional(v.string()),
  scope: v.string(),
  client: mcpClientSchema,
  clientSecretId: v.optional(v.string()),
})

function json(value: string): unknown {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed
  } catch {
    throw new Error('mcp_auth_binding_invalid')
  }
}

/** Save pre-registration before authorization; a client secret never leaves its purpose-bound envelope. */
export async function configureMcpOAuthClient(
  db: ManagementDb,
  kek: string,
  serverId: string,
  clientValue: unknown,
  secret: string | undefined,
  now = Date.now(),
) {
  await mcpServer(db, serverId)
  const client = v.parse(mcpClientSchema, clientValue)
  if (client.registration !== 'preregistered' || (client.method !== 'none' && !secret))
    throw new TypeError('mcp_client_invalid')
  const registrationId = uuidv7(now)
  const envelope = secret
    ? await mcpSecretInsert(
        db,
        kek,
        serverId,
        'mcp_client',
        mcpClientSecretPayload(client, secret),
        now,
      )
    : undefined
  const insert = db
    .insert(mcpOAuthClients)
    .values({
      registrationId,
      serverId,
      issuer: client.issuer,
      redirectUri: client.redirectUri,
      metadataJson: JSON.stringify(client),
      secretId: envelope?.credentialId,
      status: 'ready',
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [mcpOAuthClients.serverId, mcpOAuthClients.issuer, mcpOAuthClients.redirectUri],
      set: {
        registrationId,
        metadataJson: JSON.stringify(client),
        secretId: envelope?.credentialId ?? null,
        status: 'ready',
        createdAt: now,
      },
    })
  await db.batch(envelope ? [envelope.statement, insert] : [insert])
  return { registrationId }
}

/** Start PKCE after public metadata discovery. Consent does not create an agent assignment. */
export async function startMcpOAuth(
  db: ManagementDb,
  kek: string,
  origin: string,
  serverId: string,
  browserNonce: string,
  selectedIssuer?: string,
  scope = '',
  initialTokenId?: string,
  now = Date.now(),
  requestId?: string,
  loopbackRedirectUri?: string,
) {
  if (
    browserNonce.length < 32 ||
    browserNonce.length > 256 ||
    scope.length > 2_048 ||
    /[\r\n]/u.test(scope)
  )
    throw new TypeError('mcp_auth_request_invalid')
  const server = await mcpServer(db, serverId)
  const document = loopbackRedirectUri ? undefined : mcpClientDocument(origin)
  const redirectUri = loopbackRedirectUri
    ? mcpLoopbackRedirect(loopbackRedirectUri)
    : document?.redirect_uris[0]
  if (!redirectUri) throw new Error('mcp_ui_origin_invalid')
  const signal = AbortSignal.timeout(10_000)
  const discovered = await discoverMcpOAuth(server.endpoint, selectedIssuer, signal)
  const metadata = discovered.metadata
  const existing = await db
    .select()
    .from(mcpOAuthClients)
    .where(
      and(
        eq(mcpOAuthClients.serverId, serverId),
        eq(mcpOAuthClients.issuer, metadata.issuer),
        eq(mcpOAuthClients.redirectUri, redirectUri),
      ),
    )
    .get()
  let client: v.InferOutput<typeof mcpClientSchema>
  let clientSecretId: string | undefined
  if (existing) {
    if (existing.status !== 'ready' || !existing.metadataJson)
      throw new Error('mcp_client_registration_required')
    client = v.parse(mcpClientSchema, json(existing.metadataJson))
    clientSecretId = existing.secretId ?? undefined
  } else if (document && metadata.client_id_metadata_document_supported) {
    client = {
      issuer: metadata.issuer,
      clientId: document.client_id,
      method: 'none',
      redirectUri,
      registration: 'metadata',
    }
  } else if (metadata.registration_endpoint) {
    const registrationId = uuidv7(now)
    // Persist before the external side effect. A crash never silently replays DCR.
    await db.insert(mcpOAuthClients).values({
      registrationId,
      serverId,
      issuer: metadata.issuer,
      redirectUri,
      status: 'registering',
      createdAt: now,
    })
    try {
      let initialToken: string | undefined
      if (initialTokenId) {
        const stored = await mcpSecret(db, kek, serverId, initialTokenId)
        if (stored.row.kind !== 'mcp_client') throw new Error('mcp_auth_binding_invalid')
        const initial = v.parse(
          v.strictObject({
            kind: v.literal('initial'),
            issuer: v.string(),
            endpoint: v.string(),
            secret: v.string(),
          }),
          json(stored.secret),
        )
        if (
          initial.issuer !== metadata.issuer ||
          initial.endpoint !== metadata.registration_endpoint
        )
          throw new Error('mcp_auth_binding_invalid')
        initialToken = initial.secret
      }
      const result = await registerMcpOAuthClient(
        metadata.registration_endpoint,
        origin,
        initialToken,
        signal,
        loopbackRedirectUri,
      )
      client = {
        issuer: metadata.issuer,
        clientId: result.client_id,
        method: result.token_endpoint_auth_method,
        redirectUri,
        registration: 'dynamic',
      }
      const envelope = result.client_secret
        ? await mcpSecretInsert(
            db,
            kek,
            serverId,
            'mcp_client',
            mcpClientSecretPayload(client, result.client_secret),
            now,
          )
        : undefined
      clientSecretId = envelope?.credentialId
      const complete = db
        .update(mcpOAuthClients)
        .set({ status: 'ready', metadataJson: JSON.stringify(client), secretId: clientSecretId })
        .where(eq(mcpOAuthClients.registrationId, registrationId))
      await db.batch(envelope ? [envelope.statement, complete] : [complete])
    } catch {
      await db
        .update(mcpOAuthClients)
        .set({ status: 'reauth_required' })
        .where(eq(mcpOAuthClients.registrationId, registrationId))
      throw new Error('mcp_client_registration_required')
    }
  } else throw new Error('mcp_client_registration_required')
  if (
    client.issuer !== metadata.issuer ||
    client.redirectUri !== redirectUri ||
    !metadata.token_endpoint_auth_methods_supported.includes(client.method)
  )
    throw new Error('mcp_client_binding_invalid')
  const current = await mcpServer(db, serverId)
  if (current.revision !== server.revision) throw new Error('mcp_auth_binding_changed')
  const transactionId = uuidv7(now)
  const state = randomSecret()
  const verifier = randomSecret()
  const envelope = await mcpSecretInsert(
    db,
    kek,
    serverId,
    'mcp_transaction',
    verifier,
    now,
    now + 600_000,
  )
  const binding = {
    endpoint: server.endpoint,
    resource: discovered.resource,
    issuer: metadata.issuer,
    authorizationEndpoint: metadata.authorization_endpoint,
    tokenEndpoint: metadata.token_endpoint,
    revocationEndpoint: metadata.revocation_endpoint,
    scope,
    client,
    clientSecretId,
  }
  await db.batch([
    envelope.statement,
    db.insert(mcpOAuthTransactions).values({
      requestId,
      transactionId,
      serverId,
      serverRevision: server.revision,
      stateDigest: await digest(state),
      browserDigest: await digest(browserNonce),
      bindingJson: JSON.stringify(binding),
      verifierId: envelope.credentialId,
      status: 'pending',
      expiresAt: now + 600_000,
      createdAt: now,
    }),
    auditStatement(db, {
      opId: `mcp.oauth.start:${transactionId}`,
      at: now,
      source: 'operator',
      action: 'mcp.oauth.start',
      targetKind: 'system',
      targetId: serverId,
      detail: { transactionId, revision: server.revision },
    }),
  ])
  const authorization = new URL(metadata.authorization_endpoint)
  const parameters = {
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: redirectUri,
    resource: discovered.resource,
    scope,
    state,
    code_challenge: await digest(verifier),
    code_challenge_method: 'S256',
  }
  for (const [key, value] of Object.entries(parameters)) authorization.searchParams.set(key, value)
  return {
    transactionId,
    authorizationUrl: authorization.href,
    expiresAt: now + 600_000,
    consent: {
      serverId,
      resource: discovered.resource,
      issuer: metadata.issuer,
      clientId: client.clientId,
      scope,
      redirectUri,
    },
  }
}

/** Claim the callback once before exchanging the code; errors never expose an AS response or code. */
export async function completeMcpOAuth(
  db: ManagementDb,
  kek: string,
  origin: string,
  input: {
    state: string
    browserNonce: string
    code?: string
    issuer?: string
    denied?: boolean
    loopbackRedirectUri?: string
  },
  now = Date.now(),
) {
  if (
    !input.state ||
    input.state.length > 256 ||
    input.browserNonce.length < 32 ||
    input.browserNonce.length > 256 ||
    (input.code !== undefined && (!input.code || input.code.length > 8_192))
  )
    throw new Error('mcp_auth_callback_invalid')
  const stateDigest = await digest(input.state)
  const transaction = await db
    .select()
    .from(mcpOAuthTransactions)
    .where(
      and(
        eq(mcpOAuthTransactions.stateDigest, stateDigest),
        eq(mcpOAuthTransactions.browserDigest, await digest(input.browserNonce)),
        eq(mcpOAuthTransactions.status, 'pending'),
        gt(mcpOAuthTransactions.expiresAt, now),
      ),
    )
    .get()
  if (!transaction) throw new Error('mcp_auth_callback_invalid')
  const binding = v.parse(bindingSchema, json(transaction.bindingJson))
  const server = await mcpServer(db, transaction.serverId)
  if (
    binding.client.redirectUri !==
      (input.loopbackRedirectUri
        ? mcpLoopbackRedirect(input.loopbackRedirectUri)
        : mcpClientDocument(origin).redirect_uris[0]) ||
    binding.client.issuer !== binding.issuer ||
    (input.issuer !== undefined && input.issuer !== binding.issuer) ||
    server.revision !== transaction.serverRevision ||
    server.endpoint !== binding.endpoint ||
    binding.resource !== server.endpoint
  )
    throw new Error('mcp_auth_binding_changed')
  const claimed = await db
    .update(mcpOAuthTransactions)
    .set({ status: input.denied ? 'denied' : 'exchanging' })
    .where(
      and(
        eq(mcpOAuthTransactions.transactionId, transaction.transactionId),
        eq(mcpOAuthTransactions.status, 'pending'),
      ),
    )
    .returning()
    .get()
  if (!claimed) throw new Error('mcp_auth_callback_consumed')
  if (input.denied) {
    await eraseMcpSecret(db, transaction.verifierId, now)
    return { status: 'denied' as const }
  }
  try {
    if (!input.code) throw new Error('mcp_auth_callback_invalid')
    const verifier = await mcpSecret(db, kek, server.serverId, transaction.verifierId)
    if (verifier.row.kind !== 'mcp_transaction') throw new Error('mcp_auth_binding_invalid')
    const secret = await mcpClientSecret(
      db,
      kek,
      server.serverId,
      binding.clientSecretId,
      binding.client,
    )
    const tokens = await exchangeMcpToken(
      binding.tokenEndpoint,
      binding.client,
      secret,
      {
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: binding.client.redirectUri,
        resource: binding.resource,
        code_verifier: verifier.secret,
      },
      AbortSignal.timeout(10_000),
    )
    const current = await mcpServer(db, server.serverId)
    if (current.revision !== transaction.serverRevision) throw new Error('mcp_auth_binding_changed')
    if (
      tokens.scope &&
      tokens.scope.split(/\s+/u).some((scope) => !binding.scope.split(/\s+/u).includes(scope))
    )
      throw new Error('mcp_scope_changed')
    const issuedAt = Date.now()
    const expiresAt = tokens.expires_in === undefined ? null : issuedAt + tokens.expires_in * 1_000
    const envelope = await mcpSecretInsert(
      db,
      kek,
      server.serverId,
      'mcp_oauth',
      JSON.stringify({
        kind: 'mcp_oauth',
        serverId: server.serverId,
        serverRevision: transaction.serverRevision,
        endpoint: binding.endpoint,
        access: tokens.access_token,
        refresh: tokens.refresh_token,
        expiresAt,
        scope: tokens.scope ?? binding.scope,
        resource: binding.resource,
        issuer: binding.issuer,
        tokenEndpoint: binding.tokenEndpoint,
        revocationEndpoint: binding.revocationEndpoint,
        client: binding.client,
        clientSecretId: binding.clientSecretId,
      }),
      issuedAt,
      expiresAt,
    )
    await db.batch([
      envelope.statement,
      eraseMcpSecret(db, transaction.verifierId, issuedAt),
      db
        .update(mcpOAuthTransactions)
        .set({ status: 'completed', credentialId: envelope.credentialId })
        .where(eq(mcpOAuthTransactions.transactionId, transaction.transactionId)),
      auditStatement(db, {
        opId: `mcp.oauth.complete:${transaction.transactionId}`,
        at: issuedAt,
        source: 'operator',
        action: 'mcp.oauth.complete',
        targetKind: 'system',
        targetId: server.serverId,
        detail: { transactionId: transaction.transactionId, credentialId: envelope.credentialId },
      }),
    ])
    return {
      status: 'completed' as const,
      requestId: transaction.requestId,
      credentialId: envelope.credentialId,
      expiryKnown: expiresAt !== null,
    }
  } catch {
    await db.batch([
      eraseMcpSecret(db, transaction.verifierId, Date.now()),
      db
        .update(mcpOAuthTransactions)
        .set({ status: 'reauth_required' })
        .where(eq(mcpOAuthTransactions.transactionId, transaction.transactionId)),
    ])
    throw new Error('mcp_reauth_required')
  }
}
