/** Common bounded search data, separate from application-only Google display artifacts. @module */
import { limitText, normalizeUrl } from './url.ts'

/** A validated source is a candidate for a one-shot same-run fetch permission. */
export interface SearchSource {
  url: string
  title: string
}

/** Provider measurements are observations, not monetary authorizations. */
export interface SearchResult {
  answer: string
  sources: SearchSource[]
  searchCount: number | null
  countKind: 'search_calls' | 'provider_requests' | 'google_queries'
  inputTokens: number | null
  outputTokens: number | null
  answerTruncated: boolean
  sourcesTruncated: boolean
}

/** Normalize, deduplicate and bound sources without truncating a URL into another destination. */
export function searchSources(sources: readonly SearchSource[]): SearchSource[] {
  const seen = new Set<string>()
  return sources.flatMap((source) => {
    let url: string
    try {
      url = normalizeUrl(source.url)
    } catch {
      return []
    }
    if (seen.has(url)) return []
    seen.add(url)
    return [{ url, title: limitText(source.title || url, 300) }]
  })
}

/** Assemble a valid JSON envelope after limiting fields; never slice serialized JSON. */
export function externalEnvelope(
  tool: 'web_search' | 'web_fetch',
  ref: string,
  data: unknown,
): string {
  const result = JSON.stringify({
    type: 'untrusted_external_data',
    version: 1,
    source: { tool, ref },
    data,
  })
  if (new TextEncoder().encode(result).byteLength > 128 * 1_024) throw new Error('result_too_large')
  return result
}

/** Apply shared answer/source bounds to validated provider data. */
export function boundedSearch(
  result: Omit<SearchResult, 'answerTruncated' | 'sourcesTruncated'>,
): SearchResult {
  const sources = searchSources(result.sources)
  return {
    ...result,
    answer: limitText(result.answer, 12_000),
    sources: sources.slice(0, 20),
    answerTruncated: Array.from(result.answer).length > 12_000,
    sourcesTruncated: sources.length > 20,
  }
}
