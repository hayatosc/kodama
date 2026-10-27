/** ChatGPT token endpoint validation and safe failure classification. @module */
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

afterEach(() => vi.restoreAllMocks())

it('refreshes inside Pi auth’s preemptive window', () => {
  expect(refreshDue({ ...credential, expires: 301_000 }, 1000)).toBe(true)
  expect(refreshDue({ ...credential, expires: 301_001 }, 1000)).toBe(false)
})

it('retains account metadata and accepts returned scopes without requiring rotation', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const request = new Request(url, init)
    expect(request.redirect).toBe('manual')
    expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded')
    expect(new URLSearchParams(await request.text())).toEqual(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: 'stored-refresh',
        client_id: 'issued-client',
      }),
    )
    return Response.json({
      access_token: 'renewed-access',
      expires_in: 3600,
      scope: 'openid chatgpt.tokens.use.direct',
    })
  })
  expect(await refreshChatGPT(credential, () => 1000)).toEqual({
    ...credential,
    access: 'renewed-access',
    expires: 3_421_000,
    scopes: ['openid', 'chatgpt.tokens.use.direct'],
  })
})

it.each([
  { error: 'invalid_grant' },
  { error: { code: 'refresh_token_reused', message: 'do-not-expose' } },
  { error: { code: 'refresh_token_expired' } },
  { error: { code: 'refresh_token_invalidated' } },
])('classifies terminal token rejection without exposing its body', async (body) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(body, { status: 400 }))
  await expect(refreshChatGPT(credential, Date.now)).rejects.toThrow(REFRESH_REJECTED)
})

it.each([401, 403])('requires reauthentication on HTTP %s even without JSON', async (status) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('do-not-expose', { status }))
  await expect(refreshChatGPT(credential, Date.now)).rejects.toThrow(REFRESH_REJECTED)
})

it('requires a fresh login rather than guessing a missing client ID', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  await expect(refreshChatGPT({ ...credential, clientId: undefined }, Date.now)).rejects.toThrow(
    REFRESH_REJECTED,
  )
  expect(fetch).not.toHaveBeenCalled()
})

it('requires reauthentication when the provider removes direct-token scope', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      access_token: 'renewed-access',
      expires_in: 3600,
      scope: 'openid',
    }),
  )
  await expect(refreshChatGPT(credential, Date.now)).rejects.toThrow(REFRESH_REJECTED)
})

it.each([
  { expires_in: 3600 },
  { access_token: 'renewed-access', expires_in: -1 },
  { access_token: 'renewed-access', expires_in: '3600' },
  { access_token: 'renewed-access', expires_in: 3600, refresh_token: '' },
])('does not accept malformed success payloads', async (body) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(body))
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
