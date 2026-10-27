/** Node's real Pi OAuth flow accepts a manual redirect without persisting credentials. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { apiKeyRegistration, loginRegistration } from './local-login.ts'

const installId = '019a0000-0000-7000-8000-000000000001'
afterEach(() => vi.restoreAllMocks())

it('accepts only nonempty API keys and never includes input in errors', () => {
  expect(JSON.parse(apiKeyRegistration('openai', 'request', 'sk-local-test'))).toMatchObject({
    kind: 'api_key',
    secret: 'sk-local-test',
  })
  expect(() => apiKeyRegistration('openai', 'request', '')).toThrow('No API key supplied')
})

it('produces a ChatGPT URL, accepts a pasted redirect, and registers the OAuth result in memory', async () => {
  let authorization: URL | undefined
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      access_token: 'private-access',
      refresh_token: 'private-refresh',
      id_token: 'private-id',
      expires_in: 3600,
      scope: 'openid chatgpt.tokens.use.direct',
    }),
  )
  const json = await loginRegistration(installId, 'login-request', {
    notify(event) {
      if (event.type === 'auth_url') authorization = new URL(event.url)
    },
    async prompt() {
      expect(authorization?.origin).toBe('https://auth.openai.com')
      expect(authorization?.searchParams.get('ext_agent_host_id')).toBe(`urn:uuid:${installId}`)
      expect(authorization?.searchParams.get('agent_name_hint')).toBe('kodama')
      return `http://127.0.0.1:1455/auth/callback?code=test-code&state=${authorization?.searchParams.get('state')}&client_id=issued-client`
    },
  })
  expect(JSON.parse(json)).toMatchObject({
    provider: 'openai',
    kind: 'oauth_subscription',
    requestId: 'login-request',
  })
  const body: { secret: string } = JSON.parse(json)
  expect(JSON.parse(body.secret)).toMatchObject({
    type: 'oauth',
    access: 'private-access',
    refresh: 'private-refresh',
    clientId: 'issued-client',
    scopes: ['openid', 'chatgpt.tokens.use.direct'],
  })
  expect(fetch).toHaveBeenCalledOnce()
})

it('hides provider response bodies containing credentials on a failed token exchange', async () => {
  let state = ''
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('private-provider-token', { status: 500 }),
  )
  await expect(
    loginRegistration(installId, 'failed-exchange', {
      notify(event) {
        if (event.type === 'auth_url') state = new URL(event.url).searchParams.get('state') ?? ''
      },
      async prompt() {
        return `http://127.0.0.1:1455/auth/callback?code=private-code&state=${state}&client_id=issued-client`
      },
    }),
  ).rejects.toThrow('ChatGPT login failed; retry with the full redirect URL from the browser.')
})

it('does not expose a pasted redirect or provider error in a failed login', async () => {
  await expect(
    loginRegistration(installId, 'bad', {
      notify() {},
      async prompt() {
        return 'http://evil.invalid/?code=private-code'
      },
    }),
  ).rejects.toThrow('ChatGPT login failed')
})
