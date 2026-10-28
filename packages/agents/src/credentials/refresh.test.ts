/** ChatGPT token endpoint contracts from RFC 6749 and the bundled Pi OAuth client. @module */
import type { OAuthCredential } from '@earendil-works/pi-ai'
import { afterEach, expect, it, vi } from 'vitest'
import { REFRESH_REJECTED, refreshChatGPT, refreshDue } from './refresh.ts'

const credential: OAuthCredential = {
  type: 'oauth',
  access: 'expired-access',
  refresh: 'stored-refresh',
  expires: 0,
  clientId: 'issued-client',
  scopes: ['chatgpt.tokens.use.direct'],
  accountId: 'kept-account',
}
const token = { access_token: 'renewed-access', token_type: 'Bearer', expires_in: 3600 }

afterEach(() => vi.restoreAllMocks())

it('refreshes inside Pi auth’s preemptive window', () => {
  expect(refreshDue({ ...credential, expires: 301_000 }, 1000)).toBe(true)
  expect(refreshDue({ ...credential, expires: 301_001 }, 1000)).toBe(false)
})

it('sends exactly Pi’s public-client refresh fields and headers', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(token))
  await refreshChatGPT(credential, () => 1000)
  const [url, init] = fetch.mock.calls[0] ?? []
  if (!url) throw new Error('Missing refresh request')
  const request = new Request(url, init)
  expect(request.url).toBe('https://auth.openai.com/api/accounts/oauth/token')
  expect(request.method).toBe('POST')
  expect(request.redirect).toBe('manual')
  expect(request.headers.get('accept')).toBe('application/json')
  expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded')
  expect(request.headers.has('authorization')).toBe(false)
  const form = new URLSearchParams(await request.text())
  form.sort()
  expect([...form.entries()]).toEqual([
    ['client_id', 'issued-client'],
    ['grant_type', 'refresh_token'],
    ['refresh_token', 'stored-refresh'],
    ['resource', 'https://api.openai.com/v1'],
  ])
})

// RFC 6749 §§5.1, 6: rotation is optional, omitted scope retains the grant, unknown fields are ignored.
it.each([
  { rotation: false, scope: false },
  { rotation: true, scope: false },
  { rotation: false, scope: true },
  { rotation: true, scope: true },
])('parses a spec-shaped success (rotation: $rotation, scope: $scope)', async (options) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      ...token,
      access_token: 'a',
      token_type: 'bEaReR',
      ...(options.rotation ? { refresh_token: 'r' } : {}),
      ...(options.scope ? { scope: 'openid chatgpt.tokens.use.direct' } : {}),
      extension_parameter: 'ignored',
    }),
  )
  expect(await refreshChatGPT(credential, () => 1000)).toEqual({
    ...credential,
    access: 'a',
    refresh: options.rotation ? 'r' : credential.refresh,
    expires: 3_421_000,
    scopes: options.scope ? ['openid', 'chatgpt.tokens.use.direct'] : credential.scopes,
  })
})

it('requires reauthentication on HTTP 401 without echoing a non-JSON body', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('do-not-expose', { status: 401 }))
  await expect(refreshChatGPT(credential, Date.now)).rejects.toThrow(REFRESH_REJECTED)
})

it.each([undefined, { detail: 'do-not-expose' }, { error: { code: 'permission_denied' } }])(
  'does not infer unusable credentials from HTTP 403 without a permanent code',
  async (body) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      body === undefined
        ? new Response('do-not-expose', { status: 403 })
        : Response.json(body, { status: 403 }),
    )
    await expect(refreshChatGPT(credential, Date.now)).rejects.toThrow(
      'credential_unavailable: OAuth refresh temporarily unavailable',
    )
  },
)

it('recognizes a permanent OpenAI error object even on HTTP 403', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ error: { code: 'refresh_token_reused' } }, { status: 403 }),
  )
  await expect(refreshChatGPT(credential, Date.now)).rejects.toThrow(REFRESH_REJECTED)
})

it.each([302, 429, 500, 503])(
  'does not invalidate credentials on HTTP %s even with a permanent code',
  async (status) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ error: 'invalid_client' }, { status }),
    )
    await expect(refreshChatGPT(credential, Date.now)).rejects.toThrow(
      'credential_unavailable: OAuth refresh temporarily unavailable',
    )
  },
)

it('requires a fresh login rather than guessing a missing client ID', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  await expect(refreshChatGPT({ ...credential, clientId: undefined }, Date.now)).rejects.toThrow(
    REFRESH_REJECTED,
  )
  expect(fetch).not.toHaveBeenCalled()
})

it('requires reauthentication when the provider removes direct-token scope', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ...token, scope: 'openid' }))
  await expect(refreshChatGPT(credential, Date.now)).rejects.toThrow(REFRESH_REJECTED)
})

it.each([
  { access_token: undefined },
  { access_token: '' },
  { access_token: '   ' },
  { token_type: undefined },
  { token_type: 'MAC' },
  { expires_in: undefined },
  { expires_in: 0 },
  { expires_in: -1 },
  { expires_in: '3600' },
  { refresh_token: '' },
  { refresh_token: '   ' },
  { scope: [] },
])('rejects malformed or unsupported success fields: %j', async (fields) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ...token, ...fields }))
  await expect(refreshChatGPT(credential, Date.now)).rejects.toThrow(
    'credential_unavailable: invalid OAuth refresh response',
  )
})

// Unknown errors are not proof of an unusable grant, so the stored credential is kept.
it.each([
  ['an empty object', '{}'],
  ['a non-JSON body', 'do-not-expose'],
  ['an error object without a code', '{"error":{"message":"do-not-expose"}}'],
  ['an unknown error code', '{"error":"temporarily_unavailable"}'],
])('treats HTTP 400 with %s as temporary', async (_label, body) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 400 }))
  await expect(refreshChatGPT(credential, Date.now)).rejects.toThrow(
    'credential_unavailable: OAuth refresh temporarily unavailable',
  )
})

it.each([
  ['a non-JSON body', 'do-not-expose', 'credential_unavailable: OAuth refresh request failed'],
  [
    'an infinite expires_in',
    '{"access_token":"a","token_type":"Bearer","expires_in":1e400}',
    'credential_unavailable: invalid OAuth refresh response',
  ],
  [
    'a non-string refresh_token',
    '{"access_token":"a","token_type":"Bearer","expires_in":60,"refresh_token":7}',
    'credential_unavailable: invalid OAuth refresh response',
  ],
])('keeps the credential on a malformed success with %s', async (_label, body, message) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(body, { headers: { 'content-type': 'application/json' } }),
  )
  await expect(refreshChatGPT(credential, Date.now)).rejects.toThrow(message)
})

it('reads a space-delimited scope with surrounding and repeated whitespace', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ ...token, scope: '  openid   chatgpt.tokens.use.direct ' }),
  )
  expect((await refreshChatGPT(credential, () => 1000)).scopes).toEqual([
    'openid',
    'chatgpt.tokens.use.direct',
  ])
})

it('requires the HTTP 200 token response specified by RFC 6749 §5.1', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(token, { status: 201 }))
  await expect(refreshChatGPT(credential, Date.now)).rejects.toThrow(
    'credential_unavailable: invalid OAuth refresh response',
  )
})

it('does not echo network exception details', async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('do-not-expose'))
  await expect(refreshChatGPT(credential, Date.now)).rejects.toThrow(
    'credential_unavailable: OAuth refresh request failed',
  )
})

it('combines caller cancellation with a timeout below the lease duration', async () => {
  const abort = new AbortController()
  const timeout = vi.spyOn(AbortSignal, 'timeout')
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    await new Promise<void>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
    return Response.json({})
  })
  const refresh = expect(refreshChatGPT(credential, Date.now, abort.signal)).rejects.toThrow(
    'credential_unavailable',
  )
  expect(timeout).toHaveBeenCalledWith(10_000)
  abort.abort()
  await refresh
})
