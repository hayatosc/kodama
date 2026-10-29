/** One native HTTP request; callers own scoped authentication, admission and accounting. @module */
import type { NativeRoute, SearchModel } from './search-route.ts'
import { responsesRequest, readResponses } from './search-responses.ts'
import { messagesRequest, readMessages } from './search-messages.ts'
import { googleRequest, readGoogle } from './search-google.ts'
import { decodeUtf8, readBody, sseData } from './stream.ts'
import { normalizeQuery } from './url.ts'

/** Send only to the selected fixed endpoint, with no retry or keyless error fallback. */
export async function nativeSearch(
  route: NativeRoute,
  model: SearchModel,
  query: string,
  key: string,
  signal: AbortSignal,
  beforeSend: () => Promise<void>,
) {
  const normalized = normalizeQuery(query)
  const headers = new Headers({ 'content-type': 'application/json', accept: 'text/event-stream' })
  let endpoint: string = route.endpoint
  let body: unknown
  switch (route.dialect) {
    case 'responses':
      headers.set('authorization', `Bearer ${key}`)
      body = responsesRequest(route.provider, model.id, normalized)
      break
    case 'anthropic-messages':
    case 'deepseek-messages':
      headers.set('x-api-key', key)
      headers.set('anthropic-version', '2023-06-01')
      body = messagesRequest(route.dialect, model.id, normalized)
      break
    case 'google':
      headers.set('x-goog-api-key', key)
      endpoint += `/models/${encodeURIComponent(model.id)}:streamGenerateContent?alt=sse`
      body = googleRequest(normalized)
      break
  }
  await beforeSend()
  signal.throwIfAborted()
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    redirect: 'manual',
    signal,
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(response.status === 429 ? 'provider_rate_limited' : 'provider_failed')
  }
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
    await response.body?.cancel()
    throw new Error('provider_response_invalid')
  }
  const bytes = await readBody(response, 512 * 1_024, signal)
  const events = sseData(decodeUtf8(bytes))
  const parsed =
    route.dialect === 'google'
      ? readGoogle(events)
      : {
          result: route.dialect === 'responses' ? readResponses(events) : readMessages(events),
        }
  signal.throwIfAborted()
  return {
    ...parsed,
    receivedBytes: bytes.byteLength,
    provider: route.provider,
    model: model.id,
    api: route.dialect,
    fetchedAt: new Date().toISOString(),
  }
}
