/** Public web URL and query normalization shared by tools and exact permissions. @module */

/** Trim only: punctuation, case, and interior whitespace remain authorization-significant. */
export function normalizeQuery(query: string): string {
  const normalized = query.trim()
  const length = Array.from(normalized).length
  if (length < 1 || length > 1_000) throw new TypeError('invalid_query')
  return normalized
}

/** Normalize a public HTTP(S) URL without resolving DNS or following links. */
export function normalizeUrl(input: string): string {
  if (
    Array.from(input).length > 4_096 ||
    Array.from(input).some(
      (character) =>
        character <= ' ' || character === String.fromCharCode(127) || character === '\\',
    )
  ) {
    throw new TypeError('invalid_url')
  }
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new TypeError('invalid_url')
  }
  const host = url.hostname.toLowerCase().replace(/\.$/u, '')
  const reserved = [
    'localhost',
    'local',
    'internal',
    'invalid',
    'test',
    'example',
    'onion',
    'home',
    'lan',
    'arpa',
  ]
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    host.includes(':') ||
    /^\d+\.\d+\.\d+\.\d+$/u.test(host) ||
    !host.includes('.') ||
    host.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label)) ||
    reserved.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
  )
    throw new TypeError('invalid_url')
  url.hostname = host
  url.hash = ''
  const normalized = url.href
  if (Array.from(normalized).length > 4_096) throw new TypeError('invalid_url')
  return normalized
}

/** Limit user-visible strings by Unicode code points, never by UTF-16 halves. */
export function limitText(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join('')
}
