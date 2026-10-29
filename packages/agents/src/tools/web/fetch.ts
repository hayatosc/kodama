/** Public GET only: URL validation at every hop, no DNS preflight, retries or subresources. @module */
import { deadline as timed } from '../../lib/deadline.ts'
import { decodeDocument, extractHtml } from './extract.ts'
import { readBody } from './stream.ts'
import { limitText, normalizeUrl } from './url.ts'

/** Fetch inert text with caller-owned cancellation; connection-time public egress is mandatory. */
export async function fetchPage(
  input: string,
  maximum = 12_000,
  signal?: AbortSignal,
  beforeSend: () => Promise<void> = () => Promise.resolve(),
) {
  if (!Number.isInteger(maximum) || maximum < 1_000 || maximum > 20_000)
    throw new TypeError('invalid_max_chars')
  using limit = timed(15_000, signal)
  const deadline = limit.signal
  const requestedUrl = normalizeUrl(input)
  const visited = new Set<string>()
  let url = requestedUrl
  let redirects = 0
  let httpCount = 0
  while (true) {
    deadline.throwIfAborted()
    if (visited.has(url)) throw new Error('redirect_loop')
    visited.add(url)
    await beforeSend()
    deadline.throwIfAborted()
    httpCount++
    const response = await fetch(url, { method: 'GET', redirect: 'manual', signal: deadline })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel()
      if (redirects === 3) throw new Error('too_many_redirects')
      const location = response.headers.get('location')
      if (!location) throw new Error('invalid_redirect')
      const next = normalizeUrl(new URL(location, url).href)
      if (url.startsWith('https:') && next.startsWith('http:'))
        throw new Error('redirect_downgrade')
      url = next
      redirects++
      continue
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error('fetch_failed')
    }
    const contentType = response.headers.get('content-type') ?? ''
    const format = contentType.split(';')[0]?.trim().toLowerCase()
    if (!format || !['text/html', 'text/plain', 'text/markdown'].includes(format)) {
      await response.body?.cancel()
      throw new Error('unsupported_content_type')
    }
    const bytes = await readBody(response, 2 * 1_024 * 1_024, deadline)
    const { decoded, charset } = decodeDocument(bytes, contentType, format === 'text/html')
    const result =
      format === 'text/html' && decoded.length > 0
        ? await extractHtml(decoded, maximum, deadline)
        : {
            title: '',
            text: limitText(decoded, maximum),
            truncated: Array.from(decoded).length > maximum,
          }
    deadline.throwIfAborted()
    return {
      ...result,
      requestedUrl,
      finalUrl: url,
      fetchedAt: new Date().toISOString(),
      format,
      charset,
      receivedBytes: bytes.byteLength,
      redirects,
      httpCount,
      dnsCount: 0,
    }
  }
}
