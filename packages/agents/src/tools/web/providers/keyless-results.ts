/** Fixed anonymous-service result dialects; no URL guessing from arbitrary prose. @module */
import { array, parseJson, record, text } from '../stream.ts'
import { mcpResult, mcpText } from './exa-mcp.ts'
import { normalizeUrl, limitText } from '../url.ts'

/** Fixed provisional order; no dynamic quality ranking or identity evasion. */
export const KEYLESS_PROVIDERS = ['exa', 'firecrawl', 'parallel', 'tavily'] as const
/** Providers with anonymous contracts to be verified by the owner before release. */
export type KeylessProvider = (typeof KEYLESS_PROVIDERS)[number]
/** Source data before mechanical answer construction. */
export interface KeylessSource {
  url: string
  title: string
  excerpt: string
}

function normalize(results: KeylessSource[]): KeylessSource[] {
  const seen = new Set<string>()
  const valid = results.flatMap((result) => {
    let url: string
    try {
      url = normalizeUrl(result.url)
    } catch {
      return []
    }
    if (seen.has(url)) return []
    seen.add(url)
    return [
      {
        url,
        title: limitText(result.title || url, 300),
        excerpt: limitText(result.excerpt, 12_000),
      },
    ]
  })
  if (results.length && !valid.length) throw new Error('provider_response_invalid')
  return valid
}

/** Decode only the fixed schema for the selected provider; malformed is not empty success. */
export function keylessResults(provider: KeylessProvider, body: string, contentType: string) {
  let sessionId: string | undefined
  let results: KeylessSource[]
  if (provider === 'tavily') {
    results = array(record(parseJson(body))['results']).map((value) => {
      const source = record(value)
      return {
        url: text(source['url']),
        title: text(source['title'] ?? ''),
        excerpt: text(source['content'] ?? ''),
      }
    })
  } else {
    const result = mcpResult(body, contentType, 1)
    if (provider === 'exa' && result['structuredContent'] === undefined) {
      const body = mcpText(result)
      results = body.split('\n\n---\n\n').map((part) => {
        const url = /^URL: (.+)$/mu.exec(part)?.[1]
        const title = /^Title: (.*)$/mu.exec(part)?.[1] ?? ''
        const excerpt = /^(?:Highlights|Text): ([\s\S]*)$/mu.exec(part)?.[1]
        if (!url || excerpt === undefined) throw new Error('provider_response_invalid')
        return { url, title, excerpt }
      })
    } else {
      const parsed = record(result['structuredContent'] ?? parseJson(mcpText(result)))
      if (provider === 'parallel' && parsed['session_id'] !== undefined) {
        const session = text(parsed['session_id'])
        if (!/^[A-Za-z0-9_-]{1,256}$/u.test(session)) throw new Error('provider_response_invalid')
        sessionId = session
      }
      if (provider === 'firecrawl' && parsed['success'] !== true)
        throw new Error('provider_response_invalid')
      const rows = provider === 'firecrawl' ? record(parsed['data'])['web'] : parsed['results']
      results = array(rows).map((value) => {
        const source = record(value)
        const excerpt =
          provider === 'parallel'
            ? array(source['excerpts']).map(text).join('\n')
            : provider === 'firecrawl'
              ? text(source['description'] ?? '')
              : typeof source['highlights'] === 'string'
                ? source['highlights']
                : source['highlights'] !== undefined
                  ? array(source['highlights']).map(text).join('\n')
                  : text(source['text'] ?? '')
        return { url: text(source['url']), title: text(source['title'] ?? ''), excerpt }
      })
    }
  }
  return { results: normalize(results), sessionId }
}
