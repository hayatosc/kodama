/** Anonymous search with durable cooldown callbacks, bounded serial attempts, and 429-only rotation. @module */
import { deadline as timed } from '../../lib/deadline.ts'
import { KEYLESS_PROVIDERS, keylessResults } from './keyless-results.ts'
import type { KeylessProvider } from './keyless-results.ts'
import { boundedSearch } from './search-result.ts'
import { decodeUtf8, readBody, parseJson, record, count } from './stream.ts'
import { normalizeQuery } from './url.ts'

/** Durable cooldown state, retained across calls and eviction. */
export interface ProviderState {
  blockedUntil: number
  consecutive429: number
}
/** Metadata only; never contains bodies, session identifiers, or credentials. */
export interface KeylessAttempt {
  provider: KeylessProvider
  startedAt: number
  finishedAt: number
  status: number
  reason: string
  cooldown: number | null
  bytes: number | null
}

const endpoints = {
  exa: 'https://mcp.exa.ai/mcp',
  firecrawl: 'https://mcp.firecrawl.dev/v2/mcp',
  parallel: 'https://mcp.parallel.ai/mcp',
  tavily: 'https://api.tavily.com/search',
}

/** Retry-After is a lower bound, never shortened by our conservative fallback. */
export function cooldown(
  provider: KeylessProvider,
  previous: number,
  retryAfter: string | null,
  wait: number | null,
  now: number,
): number {
  const parsed =
    retryAfter === null
      ? NaN
      : /^\d+$/u.test(retryAfter.trim())
        ? now + Number(retryAfter) * 1_000
        : Date.parse(retryAfter)
  const structured = wait === null ? NaN : now + wait * 1_000
  const resets = [parsed, structured].filter((value) => Number.isFinite(value) && value >= 0)
  const fallback =
    provider === 'exa' || provider === 'firecrawl'
      ? 86_400_000
      : Math.min(86_400_000, 3_600_000 * 2 ** Math.min(previous, 5))
  return resets.length ? Math.max(now + 60_000, ...resets) : now + fallback
}

/** Fixed protocol calls only, with honest identification and no auth/cookie headers. */
export function keylessRequest(provider: KeylessProvider, query: string, sessionId?: string) {
  const headers = new Headers({
    'content-type': 'application/json',
    'user-agent': 'kodama/0.0.0',
    accept: 'application/json, text/event-stream',
  })
  let body: unknown
  if (provider === 'tavily') {
    headers.set('accept', 'application/json')
    headers.set('X-Tavily-Access-Mode', 'keyless')
    headers.set('X-Client-Name', 'kodama')
    body = {
      query,
      search_depth: 'basic',
      chunks_per_source: 3,
      max_results: 8,
      include_answer: false,
      include_raw_content: false,
    }
  } else {
    const name =
      provider === 'exa'
        ? 'web_search_exa'
        : provider === 'firecrawl'
          ? 'firecrawl_search'
          : 'web_search'
    const args =
      provider === 'exa'
        ? { query, numResults: 8 }
        : provider === 'firecrawl'
          ? { query, limit: 8 }
          : {
              objective: query,
              search_queries: [query],
              ...(sessionId ? { session_id: sessionId } : {}),
            }
    body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }
  }
  return { endpoint: endpoints[provider], headers, body: JSON.stringify(body) }
}

/** Coordination callbacks must persist attempts/cooldowns before allowing the next send. */
export async function keylessSearch(
  query: string,
  signal: AbortSignal,
  state: (provider: KeylessProvider) => ProviderState | undefined,
  beforeSend: (provider: KeylessProvider, signal: AbortSignal) => Promise<void>,
  finish: (attempt: KeylessAttempt, next: ProviderState | undefined) => void,
  sessionId?: string,
  skip: (provider: KeylessProvider) => void = () => {},
) {
  const normalized = normalizeQuery(query)
  using limit = timed(15_000, signal)
  const deadline = limit.signal
  const skippedProviders: KeylessProvider[] = []
  const attempts: KeylessAttempt[] = []
  let totalBytes = 0
  for (const provider of KEYLESS_PROVIDERS) {
    deadline.throwIfAborted()
    const previous = state(provider)
    if (previous && previous.blockedUntil > Date.now()) {
      skippedProviders.push(provider)
      skip(provider)
      continue
    }
    const request = keylessRequest(provider, normalized, sessionId)
    await beforeSend(provider, deadline)
    // Admission checks the logical deadline before recording a send. The transport
    // budget starts only afterward, so queue time cannot create a phantom attempt.
    using attemptLimit = timed(5_000, deadline)
    const attemptSignal = attemptLimit.signal
    const startedAt = Date.now()
    let settled = false
    let status = 0
    let received: number | null = null
    let blockedUntil: number | null = null
    try {
      const response = await fetch(request.endpoint, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        redirect: 'manual',
        signal: attemptSignal,
      })
      status = response.status
      if (status === 429)
        blockedUntil = cooldown(
          provider,
          previous?.consecutive429 ?? 0,
          response.headers.get('retry-after'),
          null,
          Date.now(),
        )
      const bytes = await readBody(
        response,
        Math.min(256 * 1_024, 512 * 1_024 - totalBytes),
        attemptSignal,
        (bytes) => {
          received = bytes
        },
      )
      received = bytes.byteLength
      totalBytes += bytes.byteLength
      if (response.status === 429) {
        let wait: number | null = null
        if (provider === 'tavily') {
          try {
            wait = count(
              record(record(parseJson(decodeUtf8(bytes)))['error'])['retry_after_seconds'],
            )
          } catch {
            /* HTTP 429 remains authoritative. */
          }
        }
        const until = cooldown(
          provider,
          previous?.consecutive429 ?? 0,
          response.headers.get('retry-after'),
          wait,
          Date.now(),
        )
        const attempt = {
          provider,
          startedAt,
          finishedAt: Date.now(),
          status: response.status,
          reason: 'rate_limited',
          cooldown: until,
          bytes: bytes.byteLength,
        }
        settled = true
        finish(attempt, {
          blockedUntil: until,
          consecutive429: (previous?.consecutive429 ?? 0) + 1,
        })
        attempts.push(attempt)
        continue
      }
      if (!response.ok) {
        settled = true
        finish(
          {
            provider,
            startedAt,
            finishedAt: Date.now(),
            status: response.status,
            reason: 'provider_failed',
            cooldown: null,
            bytes: bytes.byteLength,
          },
          undefined,
        )
        throw new Error('provider_failed')
      }
      const parsed = keylessResults(
        provider,
        decodeUtf8(bytes),
        response.headers.get('content-type') ?? '',
      )
      const attempt = {
        provider,
        startedAt,
        finishedAt: Date.now(),
        status: response.status,
        reason: 'succeeded',
        cooldown: null,
        bytes: bytes.byteLength,
      }
      settled = true
      finish(attempt, { blockedUntil: 0, consecutive429: 0 })
      attempts.push(attempt)
      return {
        result: boundedSearch({
          answer: parsed.results
            .map(
              (source, index) => `${index + 1}. ${source.title}\n${source.url}\n${source.excerpt}`,
            )
            .join('\n\n'),
          sources: parsed.results,
          searchCount: attempts.length,
          countKind: 'provider_requests',
          inputTokens: null,
          outputTokens: null,
        }),
        provider,
        model: null,
        api: provider === 'tavily' ? 'keyless-rest' : 'keyless-mcp',
        fetchedAt: new Date().toISOString(),
        attempts,
        skippedProviders,
        sessionId: parsed.sessionId,
      }
    } finally {
      if (!settled)
        finish(
          {
            provider,
            startedAt,
            finishedAt: Date.now(),
            status,
            reason: attemptSignal.aborted ? 'timeout' : 'provider_response_invalid',
            cooldown: blockedUntil,
            bytes: received,
          },
          blockedUntil === null
            ? undefined
            : {
                blockedUntil,
                consecutive429: (previous?.consecutive429 ?? 0) + 1,
              },
        )
    }
  }
  const retryAt = Math.min(
    ...KEYLESS_PROVIDERS.map((provider) => state(provider)?.blockedUntil ?? Infinity),
  )
  return { error: 'search_rate_limited', retryAt, attempts, skippedProviders }
}
