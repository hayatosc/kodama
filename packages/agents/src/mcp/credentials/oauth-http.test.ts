/** OAuth discovery fixtures cover issuer pinning, fallback and confidential client authentication. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { discoverMcpOAuth, mcpClientAuthentication, registerMcpOAuthClient } from './oauth-http.ts'

const issuer = 'https://identity.example.com/tenant'
const endpoint = 'https://mcp.example.com/service'
const origin = 'https://ui.example.com'
const metadata = {
  issuer,
  authorization_endpoint: `${issuer}/authorize`,
  token_endpoint: `${issuer}/token`,
  code_challenge_methods_supported: ['S256'],
  response_types_supported: ['code'],
}
afterEach(() => vi.unstubAllGlobals())

it('uses challenge metadata and OIDC fallback without leaking credentials or following redirects', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(null, {
        status: 401,
        headers: {
          'WWW-Authenticate': 'Bearer resource_metadata="https://mcp.example.com/resource"',
        },
      }),
    )
    .mockResolvedValueOnce(Response.json({ resource: endpoint, authorization_servers: [issuer] }))
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(Response.json(metadata))
  vi.stubGlobal('fetch', fetcher)
  expect(await discoverMcpOAuth(endpoint, undefined, AbortSignal.timeout(5_000))).toEqual({
    resource: endpoint,
    metadata: {
      ...metadata,
      token_endpoint_auth_methods_supported: ['client_secret_basic'],
      client_id_metadata_document_supported: false,
    },
  })
  expect(fetcher.mock.calls[3]?.[0]).toBe(
    'https://identity.example.com/.well-known/openid-configuration/tenant',
  )
  for (const [, options] of fetcher.mock.calls) {
    expect(options?.redirect).toBe('error')
    expect(new Headers(options?.headers).has('Authorization')).toBe(false)
  }
})

it.each([
  { ...metadata, issuer: 'https://other.example.com/tenant' },
  { ...metadata, code_challenge_methods_supported: ['plain'] },
])('rejects issuer substitution or missing S256 before authorization', async (server) => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ resource: endpoint, authorization_servers: [issuer] }))
      .mockResolvedValueOnce(Response.json(server)),
  )
  await expect(discoverMcpOAuth(endpoint, undefined, AbortSignal.timeout(5_000))).rejects.toThrow(
    /^mcp_/u,
  )
})

it('encodes Basic client credentials and keeps POST secrets out of headers and URLs', () => {
  const client = {
    issuer,
    clientId: 'a:b',
    redirectUri: `${origin}/auth/mcp/callback`,
    registration: 'preregistered' as const,
  }
  const basic = mcpClientAuthentication({ ...client, method: 'client_secret_basic' }, 's e:c')
  expect(atob(basic.headers.get('Authorization')?.slice(6) ?? '')).toBe('a%3Ab:s+e%3Ac')
  expect(basic.body.has('client_secret')).toBe(false)
  const post = mcpClientAuthentication({ ...client, method: 'client_secret_post' }, 's e:c')
  expect(post.headers.has('Authorization')).toBe(false)
  expect(post.body.get('client_secret')).toBe('s e:c')
})

it('registers a native client with only the exact loopback redirect and no UI metadata', async () => {
  const redirectUri = 'http://127.0.0.1:49152/auth/mcp/callback'
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      client_id: 'native',
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
    }),
  )
  vi.stubGlobal('fetch', fetcher)
  await registerMcpOAuthClient(
    `${issuer}/register`,
    '',
    undefined,
    AbortSignal.timeout(5_000),
    redirectUri,
  )
  const body = fetcher.mock.calls[0]?.[1]?.body
  if (typeof body !== 'string') throw new Error('Expected JSON registration')
  expect(JSON.parse(body)).toEqual({
    client_name: 'Kodama CLI',
    application_type: 'native',
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  })
})

it('does not retry uncertain dynamic registration or accept another callback', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({
      client_id: 'id',
      redirect_uris: ['https://other.example.com/callback'],
      token_endpoint_auth_method: 'none',
    }),
  )
  vi.stubGlobal('fetch', fetcher)
  await expect(
    registerMcpOAuthClient(`${issuer}/register`, origin, undefined, AbortSignal.timeout(5_000)),
  ).rejects.toThrow()
  expect(fetcher).toHaveBeenCalledTimes(1)
})
