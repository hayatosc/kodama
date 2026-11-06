/** Local OAuth fixtures exercise PKCE, single-use callbacks and purpose isolation, not real servers. @module */
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { eq } from 'drizzle-orm'
import { credentials, mcpOAuthTransactions } from '../../../drizzle/management/schema.ts'
import { management } from '../../testing/management.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import { registerMcpCatalog } from '../registration/catalog.ts'
import { completeMcpOAuth, startMcpOAuth } from './oauth.ts'
import { mcpToken, putMcpBearer } from './vault.ts'
import { authorizeMcp, disconnectMcp, markMcpAuthenticationFailure } from './refresh.ts'
import { parseCredential } from '../../credentials/vault.ts'
import { manageMcpOAuth } from './operations.ts'
import { mcpRequest, closeMcpSession } from '../connection/transport.ts'
import { mcpLoopbackRedirect } from './oauth-http.ts'

const kek = btoa(String.fromCharCode(...new Uint8Array(32).fill(42)))
const origin = 'https://ui.example.com'
const issuer = 'https://auth.example.com/'
const browserNonce = 'browser-session-nonce-at-least-32-characters'
const tokenCalls = (calls: Parameters<typeof fetch>[]) =>
  calls.filter(([url]) =>
    (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).endsWith('/token'),
  )

async function setup(query = '') {
  const now = Date.now()
  const server = await registerMcpCatalog(
    management,
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
        authorization_endpoint: `https://auth.example.com/authorize${query}`,
        token_endpoint: `https://auth.example.com/token${query}`,
        revocation_endpoint: `https://auth.example.com/revoke${query}`,
        code_challenge_methods_supported: ['S256'],
        response_types_supported: ['code'],
        token_endpoint_auth_methods_supported: ['none'],
        client_id_metadata_document_supported: true,
      })
    if (url === `https://auth.example.com/token${query}`) {
      expect(options?.redirect).toBe('error')
      return Response.json({
        access_token: 'access-fixture',
        refresh_token: 'refresh-fixture',
        token_type: 'Bearer',
        expires_in: 3600,
      })
    }
    if (url === `https://auth.example.com/revoke${query}`)
      return new Response(null, { status: 200 })
    throw new Error('Unexpected fixture URL')
  })
  vi.stubGlobal('fetch', fetcher)
  return { server, fetcher }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('MCP OAuth transactions', () => {
  it('retains endpoint routing queries through authorization, exchange and revocation', async () => {
    const query = '?tenant=a%2Fb&route=one&route=two&state=untrusted'
    const { server, fetcher } = await setup(query)
    const started = await startMcpOAuth(management, kek, origin, server.serverId, browserNonce)
    const authorization = new URL(started.authorizationUrl)
    expect(authorization.searchParams.get('tenant')).toBe('a/b')
    expect(authorization.searchParams.getAll('route')).toEqual(['one', 'two'])
    expect(authorization.searchParams.getAll('state')).toHaveLength(1)
    const state = authorization.searchParams.get('state') ?? ''
    expect(state).not.toBe('untrusted')
    const completed = await completeMcpOAuth(management, kek, origin, {
      state,
      browserNonce,
      code: 'code',
      issuer,
    })
    if (completed.status !== 'completed') throw new Error('Expected completion')
    expect(
      fetcher.mock.calls.some(([url]) => url === `https://auth.example.com/token${query}`),
    ).toBe(true)
    await disconnectMcp(management, kek, server.serverId, completed.credentialId)
    expect(
      fetcher.mock.calls.some(([url]) => url === `https://auth.example.com/revoke${query}`),
    ).toBe(true)
  })

  it('completes native PKCE into the existing vault without a UI origin and fences callback channels', async () => {
    const { server, fetcher } = await setup()
    const loopbackRedirectUri = 'http://127.0.0.1:49152/auth/mcp/callback'
    await manageMcpOAuth(management, kek, '', {
      operation: 'client-loopback',
      serverId: server.serverId,
      client: {
        issuer,
        clientId: 'native-fixture',
        method: 'none',
        redirectUri: loopbackRedirectUri,
        registration: 'preregistered',
      },
    })
    const started = await startMcpOAuth(
      management,
      kek,
      '',
      server.serverId,
      browserNonce,
      undefined,
      '',
      undefined,
      Date.now(),
      undefined,
      loopbackRedirectUri,
    )
    const authorization = new URL(started.authorizationUrl)
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorization.searchParams.get('redirect_uri')).toBe(loopbackRedirectUri)
    const state = authorization.searchParams.get('state') ?? ''
    await expect(
      completeMcpOAuth(management, kek, origin, {
        state,
        browserNonce,
        code: 'native-code',
      }),
    ).rejects.toThrow('mcp_auth_binding_changed')
    await expect(
      completeMcpOAuth(management, kek, '', {
        state,
        browserNonce,
        code: 'native-code',
        loopbackRedirectUri: 'http://127.0.0.1:49153/auth/mcp/callback',
      }),
    ).rejects.toThrow('mcp_auth_binding_changed')
    const completed = await completeMcpOAuth(management, kek, '', {
      state,
      browserNonce,
      code: 'native-code',
      loopbackRedirectUri,
    })
    if (completed.status !== 'completed') throw new Error('Expected completion')
    const stored = await mcpToken(management, kek, server.serverId, completed.credentialId)
    expect(stored.value.access).toBe('access-fixture')
    expect(JSON.stringify(completed)).not.toContain('access-fixture')
    const tokenBody = tokenCalls(fetcher.mock.calls)[0]?.[1]?.body
    expect(tokenBody instanceof URLSearchParams && tokenBody.get('redirect_uri')).toBe(
      loopbackRedirectUri,
    )
    await expect(
      completeMcpOAuth(management, kek, '', {
        state,
        browserNonce,
        code: 'native-code',
        loopbackRedirectUri,
      }),
    ).rejects.toThrow('mcp_auth_callback_invalid')
    expect(tokenCalls(fetcher.mock.calls)).toHaveLength(1)
  })

  it('does not use the UI metadata client for a native redirect', async () => {
    const { server } = await setup()
    await expect(
      startMcpOAuth(
        management,
        kek,
        '',
        server.serverId,
        browserNonce,
        undefined,
        '',
        undefined,
        Date.now(),
        undefined,
        'http://127.0.0.1:49152/auth/mcp/callback',
      ),
    ).rejects.toThrow('mcp_client_registration_required')
  })

  it.each([
    'http://localhost:49152/auth/mcp/callback',
    'http://0.0.0.0:49152/auth/mcp/callback',
    'https://127.0.0.1:49152/auth/mcp/callback',
    'http://127.0.0.1:49152/other',
    'http://127.0.0.1:49152/auth/mcp/callback?x=1',
    'http://user@127.0.0.1:49152/auth/mcp/callback',
    'http://2130706433:49152/auth/mcp/callback',
  ])('rejects noncanonical native redirect %s', (redirect) => {
    expect(() => mcpLoopbackRedirect(redirect)).toThrow()
  })
  it('serializes refresh across callers and rotates the encrypted refresh token once', async () => {
    const { server, fetcher } = await setup()
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
    const start = await startMcpOAuth(management, kek, origin, server.serverId, browserNonce)
    const completed = await completeMcpOAuth(management, kek, origin, {
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
          server.serverId,
          completed.credentialId,
          server.endpoint,
          AbortSignal.timeout(5_000),
        ),
      ),
    )
    expect(values).toEqual([
      { access: 'rotated-access', revision: 2 },
      { access: 'rotated-access', revision: 2 },
    ])
    expect(tokenCalls(fetcher.mock.calls)).toHaveLength(2)
    const stored = await mcpToken(management, kek, server.serverId, completed.credentialId)
    expect(stored.value.kind === 'mcp_oauth' && stored.value.refresh).toBe('rotated-refresh')
  })

  it.each([401, 403])(
    'does not invalidate a rotated credential for a delayed HTTP %s',
    async (status) => {
      const { server, fetcher } = await setup()
      const start = await startMcpOAuth(management, kek, origin, server.serverId, browserNonce)
      const completed = await completeMcpOAuth(management, kek, origin, {
        state: new URL(start.authorizationUrl).searchParams.get('state') ?? '',
        browserNonce,
        code: 'code',
      })
      if (completed.status !== 'completed') throw new Error('Fixture authorization failed')
      const sent = Promise.withResolvers<void>()
      const response = Promise.withResolvers<Response>()
      const original = fetcher.getMockImplementation()
      let remoteCalls = 0
      let cleanupToken = ''
      fetcher.mockImplementation(async (input, options) => {
        if (input === server.endpoint) {
          if (options?.method === 'DELETE') {
            cleanupToken = new Headers(options.headers).get('Authorization') ?? ''
            return new Response(null, { status: 204 })
          }
          remoteCalls++
          expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer access-fixture')
          sent.resolve()
          return response.promise
        }
        if (input === 'https://auth.example.com/token')
          return Response.json({
            access_token: 'rotated-access',
            refresh_token: 'rotated-refresh',
            token_type: 'Bearer',
            expires_in: 3600,
          })
        if (!original) throw new Error('Missing fixture')
        return original(input, options)
      })
      const authorize = async (signal: AbortSignal) => ({
        ...(await authorizeMcp(
          management,
          kek,
          server.serverId,
          completed.credentialId,
          server.endpoint,
          signal,
        )),
        onAuthenticationFailure: (failure: string, revision: number) =>
          markMcpAuthenticationFailure(
            management,
            server.serverId,
            completed.credentialId,
            failure,
            revision,
          ),
      })
      const session = {
        endpoint: server.endpoint,
        sessionId: 'fixture',
        nextId: 1,
        bytes: 0,
        stale: false,
      }
      const pending = mcpRequest(session, 'tools/call', {}, authorize, AbortSignal.timeout(5_000))
      const rejected = expect(pending).rejects.toThrow(
        status === 401 ? 'mcp_auth_required' : 'mcp_scope_required',
      )
      await sent.promise
      // A concurrent caller refreshes while the resource still owes revision 1 a response.
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3_600_000)
      expect(await authorize(AbortSignal.timeout(5_000))).toMatchObject({
        access: 'rotated-access',
        revision: 2,
      })
      response.resolve(new Response(null, { status }))
      await rejected
      await closeMcpSession(session, authorize)
      expect(cleanupToken).toBe('Bearer rotated-access')
      expect(remoteCalls).toBe(1)
      expect(tokenCalls(fetcher.mock.calls)).toHaveLength(2)
      expect(
        (await mcpToken(management, kek, server.serverId, completed.credentialId)).row,
      ).toMatchObject({ status: 'active', revision: 2 })
      // A current-revision failure still requires operator reauthorization.
      await markMcpAuthenticationFailure(
        management,
        server.serverId,
        completed.credentialId,
        status === 401 ? 'mcp_auth_required' : 'mcp_scope_required',
        2,
      )
      expect(
        await management
          .select()
          .from(credentials)
          .where(eq(credentials.credentialId, completed.credentialId))
          .get(),
      ).toMatchObject({ status: 'needs_reauth', revision: 2 })
    },
  )

  it('an expired refresh lease requires reauthorization rather than replay, and remains disconnectable', async () => {
    const { server, fetcher } = await setup()
    const start = await startMcpOAuth(management, kek, origin, server.serverId, browserNonce)
    const completed = await completeMcpOAuth(management, kek, origin, {
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
        server.serverId,
        completed.credentialId,
        server.endpoint,
        AbortSignal.timeout(1_000),
      ),
    ).rejects.toThrow('mcp_reauth_required')
    expect(tokenCalls(fetcher.mock.calls)).toHaveLength(1)
    expect(
      (await disconnectMcp(management, kek, server.serverId, completed.credentialId)).status,
    ).toBe('revoked')
    expect(
      (await disconnectMcp(management, kek, server.serverId, completed.credentialId)).status,
    ).toBe('revoked')
  })

  it('binds PKCE, resource and browser without a user identity; creates no agent grant and never returns tokens', async () => {
    const { server, fetcher } = await setup()
    const started = await startMcpOAuth(management, kek, origin, server.serverId, browserNonce)
    const authorization = new URL(started.authorizationUrl)
    const state = authorization.searchParams.get('state') ?? ''
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorization.searchParams.get('resource')).toBe(server.endpoint)
    expect(authorization.searchParams.get('redirect_uri')).toBe(`${origin}/auth/mcp/callback`)
    expect(authorization.searchParams.get('code_challenge')).toHaveLength(43)
    await expect(
      completeMcpOAuth(management, kek, origin, {
        state,
        browserNonce: 'different-browser-nonce-at-least-32-chars',
        code: 'code',
      }),
    ).rejects.toThrow('mcp_auth_callback_invalid')
    await expect(
      completeMcpOAuth(management, kek, origin, {
        state,
        browserNonce,
        code: 'code',
        issuer: 'https://evil.example.com/',
      }),
    ).rejects.toThrow('mcp_auth_binding_changed')
    const completed = await completeMcpOAuth(management, kek, origin, {
      state,
      browserNonce,
      code: 'code',
      issuer,
    })
    expect(completed.status).toBe('completed')
    if (completed.status !== 'completed') throw new Error('Expected completion')
    expect(JSON.stringify(completed)).not.toContain('access-fixture')
    expect(
      (await mcpToken(management, kek, server.serverId, completed.credentialId)).value.access,
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
      completeMcpOAuth(management, kek, origin, { state, browserNonce, code: 'code' }),
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
    const { server, fetcher } = await setup()
    const started = await startMcpOAuth(management, kek, origin, server.serverId, browserNonce)
    const state = new URL(started.authorizationUrl).searchParams.get('state') ?? ''
    fetcher.mockRejectedValue(new Error('secret upstream diagnostic'))
    await expect(
      completeMcpOAuth(management, kek, origin, { state, browserNonce, code: 'code' }),
    ).rejects.toThrow('mcp_reauth_required')
    await expect(
      completeMcpOAuth(management, kek, origin, { state, browserNonce, code: 'code' }),
    ).rejects.toThrow('mcp_auth_callback_invalid')
    expect(tokenCalls(fetcher.mock.calls)).toHaveLength(1)
  })

  it('erases denied transactions without exchanging codes', async () => {
    const { server, fetcher } = await setup()
    const started = await startMcpOAuth(management, kek, origin, server.serverId, browserNonce)
    const state = new URL(started.authorizationUrl).searchParams.get('state') ?? ''
    expect(
      await completeMcpOAuth(management, kek, origin, {
        state,
        browserNonce,
        denied: true,
      }),
    ).toEqual({ status: 'denied' })
    expect(tokenCalls(fetcher.mock.calls)).toHaveLength(0)
  })

  it('isolates bearer credentials by server and endpoint, and revokes locally', async () => {
    const { server } = await setup()
    const other = await setup()
    const created = await putMcpBearer(management, kek, server.serverId, 'bearer-fixture')
    await expect(
      mcpToken(management, kek, other.server.serverId, created.credentialId),
    ).rejects.toThrow('mcp_auth_required')
    await expect(
      authorizeMcp(
        management,
        kek,
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
        server.serverId,
        created.credentialId,
        server.endpoint,
        AbortSignal.timeout(1000),
      ),
    ).toEqual({ access: 'bearer-fixture', revision: 1 })
    expect(await disconnectMcp(management, kek, server.serverId, created.credentialId)).toEqual({
      status: 'revoked',
      externalRevocation: 'unavailable',
    })
    await expect(mcpToken(management, kek, server.serverId, created.credentialId)).rejects.toThrow(
      'mcp_auth_required',
    )
  })
})
