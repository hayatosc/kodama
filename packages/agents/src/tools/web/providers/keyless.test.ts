/** Anonymous protocol fixtures and cooldown-only rotation; no live quotas. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { cooldown, keylessRequest, keylessSearch } from './keyless.ts'
import type { KeylessAttempt, ProviderState } from './keyless.ts'
import type { KeylessProvider } from './keyless-results.ts'
import { keylessResults } from './keyless-results.ts'

const source = {
  url: 'https://example.org/#fragment',
  title: 'Source',
  highlights: ['Excerpt'],
  description: 'Excerpt',
  excerpts: ['Excerpt'],
  content: 'Excerpt',
}
const fixtures = {
  exa: { jsonrpc: '2.0', id: 1, result: { structuredContent: { results: [source] } } },
  firecrawl: {
    jsonrpc: '2.0',
    id: 1,
    result: {
      content: [{ type: 'text', text: JSON.stringify({ success: true, data: { web: [source] } }) }],
    },
  },
  parallel: {
    jsonrpc: '2.0',
    id: 1,
    result: { structuredContent: { session_id: 'fixture-session', results: [source] } },
  },
  tavily: { results: [source] },
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it.each(['oversized', 'stalled', 'interrupted'] as const)(
  'persists an observed 429 cooldown and measured bytes after a %s body without rotation',
  async (mode) => {
    vi.useFakeTimers()
    const states = new Map<KeylessProvider, ProviderState>()
    const attempts: KeylessAttempt[] = []
    const controller = new AbortController()
    const bytes = mode === 'oversized' ? 262_145 : 17
    const body =
      mode === 'oversized'
        ? 'x'.repeat(bytes)
        : new ReadableStream<Uint8Array>({
            start(stream) {
              stream.enqueue(new Uint8Array(bytes))
            },
          })
    const fetch = vi.fn(
      async () => new Response(body, { status: 429, headers: { 'retry-after': '172800' } }),
    )
    vi.stubGlobal('fetch', fetch)
    const now = Date.now()
    const operation = keylessSearch(
      'q',
      controller.signal,
      (provider) => states.get(provider),
      async () => {},
      (attempt, next) => {
        attempts.push(attempt)
        if (next) states.set(attempt.provider, next)
      },
    )
    const rejected = expect(operation).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(mode === 'stalled' ? 5_001 : 0)
    if (mode === 'interrupted') controller.abort()
    await rejected
    expect(fetch).toHaveBeenCalledOnce()
    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({ status: 429, bytes, cooldown: now + 172_800_000 })
    expect(states.get('exa')).toMatchObject({ blockedUntil: now + 172_800_000, consecutive429: 1 })
  },
)

it.each([
  { previous: 0, header: null, wait: 120, seconds: 120 },
  { previous: 4, header: null, wait: 120, seconds: 120 },
  { previous: 4, header: '300', wait: 120, seconds: 300 },
  { previous: 4, header: '90', wait: 120, seconds: 120 },
  { previous: 4, header: '1', wait: 2, seconds: 60 },
])('uses actual Tavily reset data instead of provisional backoff: %j', async (fixture) => {
  vi.useFakeTimers()
  const now = Date.now()
  const states = new Map<KeylessProvider, ProviderState>([
    ['exa', { blockedUntil: now + 86_400_000, consecutive429: 1 }],
    ['firecrawl', { blockedUntil: now + 86_400_000, consecutive429: 1 }],
    ['parallel', { blockedUntil: now + 86_400_000, consecutive429: 1 }],
    ['tavily', { blockedUntil: now - 1, consecutive429: fixture.previous }],
  ])
  const fetch = vi.fn(async () => {
    const headers = new Headers()
    if (fixture.header !== null) headers.set('retry-after', fixture.header)
    return new Response(JSON.stringify({ error: { retry_after_seconds: fixture.wait } }), {
      status: 429,
      headers,
    })
  })
  vi.stubGlobal('fetch', fetch)
  const attempts: KeylessAttempt[] = []
  const result = await keylessSearch(
    'q',
    new AbortController().signal,
    (provider) => states.get(provider),
    async () => {},
    (attempt, next) => {
      attempts.push(attempt)
      if (next) states.set(attempt.provider, next)
    },
  )
  const until = now + fixture.seconds * 1_000
  expect(result).toMatchObject({
    error: 'search_rate_limited',
    retryAt: until,
    skippedProviders: ['exa', 'firecrawl', 'parallel'],
  })
  expect(attempts).toMatchObject([
    { provider: 'tavily', status: 429, reason: 'rate_limited', cooldown: until },
  ])
  expect(states.get('tavily')).toEqual({
    blockedUntil: until,
    consecutive429: fixture.previous + 1,
  })
  expect(fetch).toHaveBeenCalledOnce()
})

it('retains Tavily fallback backoff when the 429 body fails before reset data is read', async () => {
  vi.useFakeTimers()
  const now = Date.now()
  const finish = vi.fn()
  const fetch = vi.fn(async () => new Response('x'.repeat(262_145), { status: 429 }))
  vi.stubGlobal('fetch', fetch)
  await expect(
    keylessSearch(
      'q',
      new AbortController().signal,
      (provider) => ({
        blockedUntil: provider === 'tavily' ? now - 1 : now + 86_400_000,
        consecutive429: 2,
      }),
      async () => {},
      finish,
    ),
  ).rejects.toThrow()
  expect(finish).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ provider: 'tavily', status: 429, cooldown: now + 14_400_000 }),
    { blockedUntil: now + 14_400_000, consecutive429: 3 },
  )
  expect(fetch).toHaveBeenCalledOnce()
})

it('starts the transport budget after delayed admission and finalizes the actual send', async () => {
  vi.useFakeTimers()
  const fetch = vi.fn(async () => new Response(JSON.stringify(fixtures.exa)))
  vi.stubGlobal('fetch', fetch)
  const finish = vi.fn()
  const operation = keylessSearch(
    'q',
    new AbortController().signal,
    () => undefined,
    async (_provider, signal) => {
      await new Promise((resolve) => setTimeout(resolve, 5_100))
      signal.throwIfAborted()
    },
    finish,
  )
  await vi.advanceTimersByTimeAsync(5_100)
  await operation
  expect(fetch).toHaveBeenCalledOnce()
  expect(finish).toHaveBeenCalledOnce()
})

it('does not record or finalize an attempt when queued admission outlasts the logical deadline', async () => {
  vi.useFakeTimers()
  const fetch = vi.fn()
  const admitted = vi.fn()
  const finish = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const operation = keylessSearch(
    'q',
    new AbortController().signal,
    () => undefined,
    async (_provider, signal) => {
      await new Promise((resolve) => setTimeout(resolve, 15_100))
      signal.throwIfAborted()
      admitted()
    },
    finish,
  )
  const rejected = expect(operation).rejects.toThrow()
  await vi.advanceTimersByTimeAsync(15_100)
  await rejected
  expect(fetch).not.toHaveBeenCalled()
  expect(admitted).not.toHaveBeenCalled()
  expect(finish).not.toHaveBeenCalled()
})

it.each(['exa', 'firecrawl', 'parallel', 'tavily'] as const)(
  'normalizes the fixed %s schema without credentials',
  (provider) => {
    expect(
      keylessResults(provider, JSON.stringify(fixtures[provider]), 'application/json').results,
    ).toEqual([{ url: 'https://example.org/', title: 'Source', excerpt: 'Excerpt' }])
    const request = keylessRequest(provider, 'question', 'fixture-session')
    expect(request.headers.has('authorization')).toBe(false)
    expect(request.headers.has('cookie')).toBe(false)
    expect(request.body).not.toContain('api_key')
    expect(request.headers.get('user-agent')).toBe('kodama/0.0.0')
    if (provider === 'parallel') expect(request.body).toContain('fixture-session')
  },
)

it('rotates only 429 in fixed order, persists before sending and reuses session privately', async () => {
  const states = new Map<KeylessProvider, ProviderState>()
  const attempts: KeylessAttempt[] = []
  const sends: KeylessProvider[] = []
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after': '120' } }))
    .mockResolvedValueOnce(new Response(JSON.stringify(fixtures.firecrawl)))
  vi.stubGlobal('fetch', fetch)
  const result = await keylessSearch(
    'question',
    new AbortController().signal,
    (provider) => states.get(provider),
    async (provider) => {
      if (provider === 'firecrawl')
        expect(states.get('exa')?.blockedUntil).toBeGreaterThan(Date.now())
      sends.push(provider)
    },
    (attempt, next) => {
      attempts.push(attempt)
      if (next) states.set(attempt.provider, next)
    },
  )
  expect(sends).toEqual(['exa', 'firecrawl'])
  expect(attempts.map((attempt) => attempt.status)).toEqual([429, 200])
  expect(result).toMatchObject({
    provider: 'firecrawl',
    result: { searchCount: 2 },
    skippedProviders: [],
  })
})

it.each([401, 500, 302])(
  'does not rotate HTTP %i and records a terminal attempt',
  async (status) => {
    const fetch = vi.fn(async () => new Response('{}', { status }))
    vi.stubGlobal('fetch', fetch)
    const finish = vi.fn()
    const skip = vi.fn()
    await expect(
      keylessSearch(
        'q',
        new AbortController().signal,
        (provider) =>
          provider === 'exa' ? { blockedUntil: Date.now() + 60_000, consecutive429: 1 } : undefined,
        async () => {},
        finish,
        undefined,
        skip,
      ),
    ).rejects.toThrow('provider_failed')
    expect(skip).toHaveBeenCalledExactlyOnceWith('exa')
    expect(fetch).toHaveBeenCalledOnce()
    expect(finish).toHaveBeenCalledOnce()
  },
)

it('fails malformed/all-invalid results rather than rotating or inventing empty success', async () => {
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { structuredContent: { results: [{ url: 'http://127.0.0.1/', text: 'bad' }] } },
        }),
      ),
  )
  vi.stubGlobal('fetch', fetch)
  const finish = vi.fn()
  await expect(
    keylessSearch(
      'q',
      new AbortController().signal,
      () => undefined,
      async () => {},
      finish,
    ),
  ).rejects.toThrow('provider_response_invalid')
  expect(fetch).toHaveBeenCalledOnce()
  expect(finish).toHaveBeenCalledOnce()
  expect(
    keylessResults(
      'exa',
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: { structuredContent: { results: [] } } }),
      'application/json',
    ).results,
  ).toEqual([])
})

it('skips cooling providers without attempts and honors floors, dates and exponential fallback', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const now = Date.now()
  const finish = vi.fn()
  const result = await keylessSearch(
    'q',
    new AbortController().signal,
    () => ({ blockedUntil: now + 120000, consecutive429: 1 }),
    async () => {},
    finish,
  )
  expect(result).toMatchObject({
    error: 'search_rate_limited',
    attempts: [],
    retryAt: now + 120000,
    skippedProviders: ['exa', 'firecrawl', 'parallel', 'tavily'],
  })
  expect(fetch).not.toHaveBeenCalled()
  expect(finish).not.toHaveBeenCalled()
  expect(cooldown('tavily', 0, '1', 120, now)).toBe(now + 120000)
  expect(cooldown('parallel', 1, null, null, now)).toBe(now + 7200000)
  expect(cooldown('exa', 0, null, null, now)).toBe(now + 86400000)
  expect(cooldown('exa', 0, new Date(now + 2 * 86400000).toUTCString(), null, now)).toBeGreaterThan(
    now + 86400000,
  )
})

it('correlates multiline MCP SSE IDs and refuses RPC errors and prose URL guessing', () => {
  const event =
    'data: {"jsonrpc":"2.0","id":1,\ndata: "result":{"structuredContent":{"results":[]}}}\n\n'
  expect(keylessResults('exa', event, 'text/event-stream').results).toEqual([])
  expect(() =>
    keylessResults('exa', '{"jsonrpc":"2.0","id":2,"result":{}}', 'application/json'),
  ).toThrow()
  expect(() =>
    keylessResults('exa', '{"jsonrpc":"2.0","id":1,"error":{"code":429}}', 'application/json'),
  ).toThrow()
  expect(() =>
    keylessResults(
      'exa',
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: { content: [{ type: 'text', text: 'Try https://example.org' }] },
      }),
      'application/json',
    ),
  ).toThrow()
})
