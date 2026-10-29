/** Bounded, cancellable response readers; no provider bodies escape as errors. @module */

/** Read a complete response under a byte cap, cancelling the reader on every exit. */
export async function readBody(
  response: Response,
  maximum: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  signal.throwIfAborted()
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let bytes = 0
  const abort = () => {
    void reader.cancel().catch(() => undefined)
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    while (true) {
      signal.throwIfAborted()
      const chunk = await reader.read()
      signal.throwIfAborted()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maximum) throw new Error('response_too_large')
      chunks.push(chunk.value)
    }
    const result = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.byteLength
    }
    return result
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

/** Decode an entire provider response strictly rather than accepting replacement characters. */
export function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
  } catch {
    throw new Error('provider_response_invalid')
  }
}

/** Parse JSON without forwarding the source text in a parse error. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('provider_response_invalid')
  }
}

/** Parse bounded SSE, joining multiline data and requiring a terminated last event. */
export function sseData(text: string): string[] {
  const normalized = text.replace(/\r\n?/gu, '\n')
  if (normalized !== '' && !normalized.endsWith('\n\n'))
    throw new Error('provider_response_invalid')
  return normalized.split('\n\n').flatMap((event) => {
    const data = event
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /u, ''))
    return data.length ? [data.join('\n')] : []
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Narrow untrusted records before examining provider-owned fields. */
export function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('provider_response_invalid')
  return value
}

/** Require a provider string, including the empty string where the dialect permits it. */
export function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('provider_response_invalid')
  return value
}

/** Require a provider array without asserting its element types. */
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('provider_response_invalid')
  return value
}

/** Unknown or invalid measurements remain null. */
export function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}
