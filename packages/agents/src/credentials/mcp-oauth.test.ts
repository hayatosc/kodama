/** Local OAuth fixtures exercise PKCE, single-use callbacks and purpose isolation, not real servers. @module */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  agents,
  credentials,
  mcpOAuthTransactions,
  principals,
} from '../../drizzle/management/schema.ts'
import { management } from '../testing/management.ts'
import { uuidv7 } from '../lib/uuid.ts'
import { registerMcpCatalog } from '../control-plane/mcp.ts'
import { completeMcpOAuth, startMcpOAuth } from './mcp-oauth.ts'
import { mcpToken, putMcpBearer } from './mcp-vault.ts'
import { authorizeMcp, disconnectMcp } from './mcp-refresh.ts'
import { parseCredential } from './vault.ts'

const kek = btoa(String.fromCharCode(...new Uint8Array(32).fill(42)))
const origin = 'https://ui.example.com'
const issuer = 'https://auth.example.com/'
const browserNonce = 'browser-session-nonce-at-least-32-characters'
const tokenCalls = (calls: Parameters<typeof fetch>[]) =>
  calls.filter(([url]) =>
    (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).endsWith('/token'),
  )

async function setup() {
  const principalId = uuidv7()
  const agentId = uuidv7()
  const now = Date.now()
  await management.batch([
    management.insert(principals).values({
      principalId,
      externalId: principalId,
      kind: 'user',
      displayName: 'OAuth owner',
      createdAt: now,
    }),
    management.insert(agents).values({
      agentId,
      objectName: agentId,
      kind: 'working',
      displayName: 'OAuth agent',
      status: 'active',
      currentVersion: 1,
      ownerId: principalId,
      createdAt: now,
      updatedAt: now,
    }),
  ])
  const server = await registerMcpCatalog(
    management,
    principalId,
    'OAuth fixture',
    `https://${uuidv7()}.example.com/mcp`,
    now,
  )
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, options) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url === server.endpoint)
      return new Response(null, {
        status: 401,
        headers: {
          'WWW-Authenticate': `Bearer resource_metadata="${new URL(server.endpoint).origin}/metadata"`,
        },
      })
    if (url.endsWith('/metadata'))
      return Response.json({ resource: server.endpoint, authorization_servers: [issuer] })
    if (url === 'https://auth.example.com/.well-known/oauth-authorization-server')
      return Response.json({
        issuer,
        authorization_endpoint: 'https://auth.example.com/authorize',
        token_endpoint: 'https://auth.example.com/token',
        revocation_endpoint: 'https://auth.example.com/revoke',
        code_challenge_methods_supported: ['S256'],
        response_types_supported: ['code'],
        token_endpoint_auth_methods_supported: ['none'],
        client_id_metadata_document_supported: true,
      })
    if (url === 'https://auth.example.com/token') {
      expect(options?.redirect).toBe('error')
      return Response.json({
        access_token: 'access-fixture',
        refresh_token: 'refresh-fixture',
        token_type: 'Bearer',
        expires_in: 3600,
      })
    }
    if (url === 'https://auth.example.com/revoke') return new Response(null, { status: 200 })
    throw new Error('Unexpected fixture URL')
  })
  vi.stubGlobal('fetch', fetcher)
  return { principalId, server, fetcher }
}

afterEach(() => vi.unstubAllGlobals())

describe('MCP OAuth transactions', () => {
  it('serializes refresh across callers and rotates the encrypted refresh token once', async () => {
    const { principalId, server, fetcher } = await setup()
    const original = fetcher.getMockImplementation()
    fetcher.mockImplementation(async (input, options) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith('/token')) {
        const form = new URLSearchParams(
          options?.body instanceof URLSearchParams || typeof options?.body === 'string'
            ? options.body
            : '',
        )
        const refreshing = form.get('grant_type') === 'refresh_token'
        if (refreshing) expect(form.get('refresh_token')).toBe('refresh-fixture')
        return Response.json({
          access_token: refreshing ? 'rotated-access' : 'access-fixture',
          refresh_token: refreshing ? 'rotated-refresh' : 'refresh-fixture',
          token_type: 'Bearer',
          expires_in: refreshing ? 3600 : 1,
        })
      }
      if (!original) throw new Error('Missing fixture')
      return original(input, options)
    })
    const start = await startMcpOAuth(
      management,
      kek,
      origin,
      principalId,
      server.serverId,
      browserNonce,
    )
    const completed = await completeMcpOAuth(management, kek, origin, principalId, {
      state: new URL(start.authorizationUrl).searchParams.get('state') ?? '',
      browserNonce,
      code: 'code',
    })
    if (completed.status !== 'completed') throw new Error('Fixture authorization failed')
    const values = await Promise.all(
      [1, 2].map(() =>
        authorizeMcp(
          management,
          kek,
          principalId,
          server.serverId,
          completed.credentialId,
          server.endpoint,
          AbortSignal.timeout(5_000),
        ),
      ),
    )
    expect(values).toEqual(['rotated-access', 'rotated-access'])
    expect(tokenCalls(fetcher.mock.calls)).toHaveLength(2)
    const stored = await mcpToken(
      management,
      kek,
      principalId,
      server.serverId,
      completed.credentialId,
    )
    expect(stored.value.kind === 'mcp_oauth' && stored.value.refresh).toBe('rotated-refresh')
  })

  it('an expired refresh lease requires reauthorization rather than replay, and remains disconnectable', async () => {
    const { principalId, server, fetcher } = await setup()
    const start = await startMcpOAuth(
      management,
      kek,
      origin,
      principalId,
      server.serverId,
      browserNonce,
    )
    const completed = await completeMcpOAuth(management, kek, origin, principalId, {
      state: new URL(start.authorizationUrl).searchParams.get('state') ?? '',
      browserNonce,
      code: 'code',
    })
    if (completed.status !== 'completed') throw new Error('Fixture authorization failed')
    await management
      .update(credentials)
      .set({ leaseId: 'interrupted-refresh', leaseExpiresAt: Date.now() - 1 })
      .where(eq(credentials.credentialId, completed.credentialId))
    await expect(
      authorizeMcp(
        management,
        kek,
        principalId,
        server.serverId,
        completed.credentialId,
        server.endpoint,
        AbortSignal.timeout(1_000),
      ),
    ).rejects.toThrow('mcp_reauth_required')
    expect(tokenCalls(fetcher.mock.calls)).toHaveLength(1)
    expect(
      (await disconnectMcp(management, kek, principalId, server.serverId, completed.credentialId))
        .status,
    ).toBe('revoked')
    expect(
      (await disconnectMcp(management, kek, principalId, server.serverId, completed.credentialId))
        .status,
    ).toBe('revoked')
  })

  it('binds PKCE, resource, browser and principal; creates no agent grant and never returns tokens', async () => {
    const { principalId, server, fetcher } = await setup()
    const started = await startMcpOAuth(
      management,
      kek,
      origin,
      principalId,
      server.serverId,
      browserNonce,
    )
    const authorization = new URL(started.authorizationUrl)
    const state = authorization.searchParams.get('state') ?? ''
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorization.searchParams.get('resource')).toBe(server.endpoint)
    expect(authorization.searchParams.get('redirect_uri')).toBe(`${origin}/auth/mcp/callback`)
    expect(authorization.searchParams.get('code_challenge')).toHaveLength(43)
    await expect(
      completeMcpOAuth(management, kek, origin, principalId, {
        state,
        browserNonce: 'different-browser-nonce-at-least-32-chars',
        code: 'code',
      }),
    ).rejects.toThrow('mcp_auth_callback_invalid')
    await expect(
      completeMcpOAuth(management, kek, origin, principalId, {
        state,
        browserNonce,
        code: 'code',
        issuer: 'https://evil.example.com/',
      }),
    ).rejects.toThrow('mcp_auth_binding_changed')
    const completed = await completeMcpOAuth(management, kek, origin, principalId, {
      state,
      browserNonce,
      code: 'code',
      issuer,
    })
    expect(completed.status).toBe('completed')
    if (completed.status !== 'completed') throw new Error('Expected completion')
    expect(JSON.stringify(completed)).not.toContain('access-fixture')
    expect(
      (await mcpToken(management, kek, principalId, server.serverId, completed.credentialId)).value
        .access,
    ).toBe('access-fixture')
    expect(() => parseCredential('mcp_oauth', '{}')).toThrow(
      'credential_unavailable: wrong purpose',
    )
    const calls = tokenCalls(fetcher.mock.calls)
    expect(calls).toHaveLength(1)
    const body = calls[0]?.[1]?.body
    if (!(body instanceof URLSearchParams)) throw new Error('Expected token form')
    const verifier = body.get('code_verifier') ?? ''
    const bytes = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    )
    const challenge = btoa(String.fromCharCode(...bytes))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/u, '')
    expect(challenge).toBe(authorization.searchParams.get('code_challenge'))
    await expect(
      completeMcpOAuth(management, kek, origin, principalId, { state, browserNonce, code: 'code' }),
    ).rejects.toThrow('mcp_auth_callback_invalid')
    expect(tokenCalls(fetcher.mock.calls)).toHaveLength(1)
    const transaction = await management
      .select()
      .from(mcpOAuthTransactions)
      .where(eq(mcpOAuthTransactions.transactionId, started.transactionId))
      .get()
    const verifierRow = await management
      .select()
      .from(credentials)
      .where(eq(credentials.credentialId, transaction?.verifierId ?? ''))
      .get()
    expect(verifierRow?.ciphertext).toBeNull()
  })

  it('makes a failed exchange terminal rather than replaying a code', async () => {
    const { principalId, server, fetcher } = await setup()
    const started = await startMcpOAuth(
      management,
      kek,
      origin,
      principalId,
      server.serverId,
      browserNonce,
    )
    const state = new URL(started.authorizationUrl).searchParams.get('state') ?? ''
    fetcher.mockRejectedValue(new Error('secret upstream diagnostic'))
    await expect(
      completeMcpOAuth(management, kek, origin, principalId, { state, browserNonce, code: 'code' }),
    ).rejects.toThrow('mcp_reauth_required')
    await expect(
      completeMcpOAuth(management, kek, origin, principalId, { state, browserNonce, code: 'code' }),
    ).rejects.toThrow('mcp_auth_callback_invalid')
    expect(tokenCalls(fetcher.mock.calls)).toHaveLength(1)
  })

  it('erases denied transactions without exchanging codes', async () => {
    const { principalId, server, fetcher } = await setup()
    const started = await startMcpOAuth(
      management,
      kek,
      origin,
      principalId,
      server.serverId,
      browserNonce,
    )
    const state = new URL(started.authorizationUrl).searchParams.get('state') ?? ''
    expect(
      await completeMcpOAuth(management, kek, origin, principalId, {
        state,
        browserNonce,
        denied: true,
      }),
    ).toEqual({ status: 'denied' })
    expect(tokenCalls(fetcher.mock.calls)).toHaveLength(0)
  })

  it('isolates bearer credentials by owner and endpoint, and revokes locally', async () => {
    const { principalId, server } = await setup()
    const other = await setup()
    const created = await putMcpBearer(
      management,
      kek,
      principalId,
      server.serverId,
      'bearer-fixture',
    )
    await expect(
      mcpToken(management, kek, other.principalId, server.serverId, created.credentialId),
    ).rejects.toThrow('mcp_auth_required')
    await expect(
      authorizeMcp(
        management,
        kek,
        principalId,
        server.serverId,
        created.credentialId,
        'https://other.example.com/mcp',
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow('mcp_auth_binding_changed')
    expect(
      await authorizeMcp(
        management,
        kek,
        principalId,
        server.serverId,
        created.credentialId,
        server.endpoint,
        AbortSignal.timeout(1000),
      ),
    ).toBe('bearer-fixture')
    expect(
      await disconnectMcp(management, kek, principalId, server.serverId, created.credentialId),
    ).toEqual({ status: 'revoked', externalRevocation: 'unavailable' })
    await expect(
      mcpToken(management, kek, principalId, server.serverId, created.credentialId),
    ).rejects.toThrow('mcp_auth_required')
  })
})
