/**
 * Common bounded search data and untrusted external data envelopes, separate from
 * application-only Google display artifacts.
 *
 * @see docs/agents.md — Web Tools
 * @module
 */
import { limitText, normalizeUrl } from './url.ts'

/** A validated source grants URL provenance required by every `web_fetch` call. */
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

/**
 * Normalize, deduplicate, and bound sources without truncating a URL into another destination.
 * When a later duplicate URL supplies a non-empty title for an earlier untitled source, upgrade
 * the title in place.
 */
export function searchSources(sources: readonly SearchSource[]): SearchSource[] {
  const seen = new Map<string, { index: number; hasTitle: boolean }>()
  const normalized: SearchSource[] = []
  for (const source of sources) {
    let url: string
    try {
      url = normalizeUrl(source.url)
    } catch {
      continue
    }
    const rawTitle = limitText(source.title.trim(), 300)
    const existing = seen.get(url)
    if (existing !== undefined) {
      const target = normalized[existing.index]
      if (target && !existing.hasTitle && rawTitle !== '') {
        target.title = rawTitle
        existing.hasTitle = true
      }
      continue
    }
    seen.set(url, { index: normalized.length, hasTitle: rawTitle !== '' })
    normalized.push({ url, title: rawTitle || limitText(url, 300) })
  }
  return normalized
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
