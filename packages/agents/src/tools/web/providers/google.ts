/** Gemini GenerateContent grounding, with suggestions isolated from model-facing data. @module */
import { array, count, parseJson, record, text } from '../stream.ts'
import { boundedSearch } from '../search-result.ts'
import type { SearchSource } from '../search-result.ts'

/** Query-only GenerateContent, not the Interactions API. */
export function googleRequest(query: string) {
  return { contents: [{ role: 'user', parts: [{ text: query }] }], tools: [{ google_search: {} }] }
}

/** Validate grounding evidence and discard suggestion HTML, which is not model data. */
export function readGoogle(events: readonly string[]) {
  let answer = ''
  let finished = false
  let grounding: Record<string, unknown> | undefined
  let usage: Record<string, unknown> = {}
  for (const data of events) {
    const event = record(parseJson(data))
    if (event['error'] !== undefined) throw new Error('provider_response_invalid')
    if (event['usageMetadata'] !== undefined) usage = record(event['usageMetadata'])
    for (const value of array(event['candidates'] ?? [])) {
      const candidate = record(value)
      if (candidate['index'] !== undefined && candidate['index'] !== 0)
        throw new Error('provider_response_invalid')
      if (candidate['content'] !== undefined) {
        for (const value of array(record(candidate['content'])['parts'])) {
          const part = record(value)
          if (part['thought'] === true) continue
          if (part['text'] !== undefined) answer += text(part['text'])
        }
      }
      if (candidate['groundingMetadata'] !== undefined)
        grounding = record(candidate['groundingMetadata'])
      if (candidate['finishReason'] !== undefined) {
        if (candidate['finishReason'] !== 'STOP') throw new Error('provider_response_invalid')
        finished = true
      }
    }
  }
  if (!finished || !answer.trim()) throw new Error('provider_response_invalid')
  if (!grounding) throw new Error('search_not_performed')
  const queries = array(grounding['webSearchQueries'] ?? []).map(text)
  const chunks = array(grounding['groundingChunks'] ?? [])
  if (!queries.length && !chunks.length) throw new Error('search_not_performed')
  const sources: SearchSource[] = chunks.map((value) => {
    const web = record(record(value)['web'])
    return { url: text(web['uri']), title: text(web['title'] ?? '') }
  })
  return {
    result: boundedSearch({
      answer,
      sources,
      searchCount: queries.length || null,
      countKind: 'google_queries',
      inputTokens: count(usage['promptTokenCount']),
      outputTokens: count(usage['candidatesTokenCount']),
    }),
  }
}
