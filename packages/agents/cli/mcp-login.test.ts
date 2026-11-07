/** Real loopback HTTP fixtures for CLI OAuth, without a browser or external services. @module */
import { describe, expect, it, vi } from 'vite-plus/test'
import * as v from 'valibot'
import { loginMcp } from './mcp-login.ts'

function fixture(clientId = 'native-client', scope = 'read') {
  const auth = vi.fn(async (value: unknown) => {
    const input = v.parse(
      v.object({
        operation: v.string(),
        loopbackRedirectUri: v.string(),
        browserNonce: v.string(),
        state: v.optional(v.string()),
        code: v.optional(v.string()),
        denied: v.optional(v.boolean()),
      }),
      value,
    )
    expect(input.browserNonce.length).toBeGreaterThanOrEqual(32)
    if (input.operation === 'begin-loopback') {
      return {
        authorizationUrl: `https://as.example.com/authorize?${new URLSearchParams({ state: 'state-fixture-with-32-characters-minimum', redirect_uri: input.loopbackRedirectUri }).toString()}`,
        consent: {
          serverId: 'server',
          issuer: 'https://as.example.com',
          resource: 'https://mcp.example.com/mcp',
          clientId,
          scope,
          redirectUri: input.loopbackRedirectUri,
        },
      }
    }
    return input.denied ? { status: 'denied' } : { status: 'completed', credentialId: 'vault-id' }
  })
  return { serverId: 'server', signal: AbortSignal.timeout(10_000), auth, notify: vi.fn() }
}

function callback(authorizationUrl: string) {
  const authorization = new URL(authorizationUrl)
  const redirect = authorization.searchParams.get('redirect_uri')
  if (!redirect) throw new Error('Missing redirect')
  const url = new URL(redirect)
  url.searchParams.set('state', authorization.searchParams.get('state') ?? '')
  url.searchParams.set('code', 'single-use-code')
  return url
}

describe('CLI MCP login', () => {
  it('binds before browser launch, rejects invalid callbacks, and forwards one valid code without logging it', async () => {
    const options = fixture()
    let endpoint = ''
    const result = await loginMcp({
      ...options,
      async open(url) {
        const valid = callback(url)
        endpoint = valid.origin
        const bad = new URL(valid)
        bad.searchParams.set('state', 'wrong-state')
        expect((await fetch(bad)).status).toBe(400)
        bad.searchParams.set('state', valid.searchParams.get('state') ?? '')
        bad.searchParams.append('code', 'duplicate')
        expect((await fetch(bad)).status).toBe(400)
        expect((await fetch(valid, { method: 'POST' })).status).toBe(400)
        const response = await fetch(valid)
        expect(response.status).toBe(200)
        expect(response.headers.get('Cache-Control')).toBe('no-store')
        expect(await response.text()).not.toContain('single-use-code')
        expect((await fetch(valid)).status).toBe(400)
      },
    })
    expect(result).toEqual({ status: 'completed', credentialId: 'vault-id' })
    expect(options.auth).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(options.notify.mock.calls)).not.toContain('single-use-code')
    await expect(fetch(endpoint)).rejects.toThrow()
  })

  it('escapes remote consent control characters without changing the browser URL', async () => {
    const options = fixture('native\u001b[2J\u009b31m\nspoof\u202e', 'read\r\t\u2028write')
    await loginMcp({
      ...options,
      async open(url) {
        expect(url).toMatch(/^https:\/\/as\.example\.com\/authorize\?/u)
        expect((await fetch(callback(url))).status).toBe(200)
      },
    })
    const display = options.notify.mock.calls.map(([message]) => message).join('\n')
    expect(display).toContain('Client: native\\u001b[2J\\u009b31m\\u000aspoof\\u202e')
    expect(display).toContain('Scope: read\\u000d\\u0009\\u2028write')
    for (const control of ['\u001b', '\u009b', '\r', '\t', '\u202e', '\u2028'])
      expect(display).not.toContain(control)
  })

  it('forwards denial without exchanging a code', async () => {
    const options = fixture()
    expect(
      await loginMcp({
        ...options,
        async open(url) {
          const denied = callback(url)
          denied.searchParams.delete('code')
          denied.searchParams.set('error', 'access_denied')
          expect((await fetch(denied)).status).toBe(200)
        },
      }),
    ).toEqual({ status: 'denied' })
    expect(options.auth.mock.calls[1]?.[0]).toMatchObject({ denied: true })
  })

  it('cancels and invalidates an unclaimed transaction', async () => {
    const options = fixture()
    const controller = new AbortController()
    await expect(
      loginMcp({
        ...options,
        signal: controller.signal,
        async open() {
          controller.abort()
        },
      }),
    ).rejects.toThrow('cancelled or expired')
    expect(options.auth.mock.calls[1]?.[0]).toMatchObject({
      operation: 'complete-loopback',
      denied: true,
    })
  })

  it('does not retry an uncertain completion or leak its diagnostic', async () => {
    const options = fixture()
    options.auth
      .mockImplementationOnce(async (value) => {
        const input = v.parse(v.object({ loopbackRedirectUri: v.string() }), value)
        return {
          authorizationUrl: `https://as.example.com/authorize?${new URLSearchParams({ state: 'state-fixture-with-32-characters-minimum', redirect_uri: input.loopbackRedirectUri }).toString()}`,
          consent: {
            serverId: 'server',
            issuer: 'https://as.example.com',
            resource: 'https://mcp.example.com/mcp',
            clientId: 'native-client',
            scope: '',
            redirectUri: input.loopbackRedirectUri,
          },
        }
      })
      .mockRejectedValueOnce(new Error('secret diagnostic'))
    await expect(
      loginMcp({
        ...options,
        async open(url) {
          const response = await fetch(callback(url))
          expect(response.status).toBe(502)
          expect(await response.text()).not.toContain('secret diagnostic')
        },
      }),
    ).rejects.toThrow('could not be confirmed')
    expect(options.auth).toHaveBeenCalledTimes(2)
  })
})
