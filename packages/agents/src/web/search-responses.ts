/** OpenAI and xAI Responses search dialects; query-only and no continuation. @module */
import { array, count, parseJson, record, text } from './stream.ts'
import { boundedSearch } from './search-result.ts'
import type { SearchSource } from './search-result.ts'

/** Build a fixed search request without history, reasoning parameters, or other tools. */
export function responsesRequest(provider: 'openai' | 'xai', model: string, query: string) {
  return {
    model,
    input: query,
    stream: true,
    store: false,
    tools: [{ type: 'web_search' }],
    tool_choice: 'required',
    include:
      provider === 'xai' ? ['web_search_call.action.sources'] : ['web_search_call.action.sources'],
  }
}

/** Require a complete response and completed search calls; never accept answer-only output. */
export function readResponses(events: readonly string[]) {
  let completed: Record<string, unknown> | undefined
  for (const data of events) {
    if (data === '[DONE]') continue
    const event = record(parseJson(data))
    if (['error', 'response.failed', 'response.incomplete'].includes(text(event['type'])))
      throw new Error('provider_response_invalid')
    if (event['type'] === 'response.completed') {
      if (completed) throw new Error('provider_response_invalid')
      completed = record(event['response'])
    }
  }
  if (!completed || completed['status'] !== 'completed')
    throw new Error('provider_response_invalid')
  let answer = ''
  let searches = 0
  const sources: SearchSource[] = []
  for (const item of array(completed['output'])) {
    const output = record(item)
    if (output['type'] === 'web_search_call') {
      if (output['status'] !== 'completed') throw new Error('provider_response_invalid')
      const action = record(output['action'])
      // This validates returned evidence, not provider-side retrieval prevention.
      if (action['type'] !== 'search') throw new Error('provider_response_invalid')
      const queries =
        action['queries'] === undefined
          ? [text(action['query'])]
          : array(action['queries']).map(text)
      if (!queries.length || queries.some((query) => !query.trim()))
        throw new Error('provider_response_invalid')
      searches++
      for (const entry of array(action['sources'] ?? [])) {
        const source = record(entry)
        sources.push({ url: text(source['url']), title: text(source['title'] ?? '') })
      }
    }
    if (output['type'] === 'message') {
      for (const entry of array(output['content'])) {
        const block = record(entry)
        if (block['type'] !== 'output_text') continue
        answer += text(block['text'])
        for (const entry of array(block['annotations'] ?? [])) {
          const citation = record(entry)
          if (citation['type'] === 'url_citation')
            sources.push({ url: text(citation['url']), title: text(citation['title'] ?? '') })
        }
      }
    }
  }
  if (!searches) throw new Error('search_not_performed')
  if (!answer.trim()) throw new Error('provider_response_invalid')
  const usage = record(completed['usage'] ?? {})
  return boundedSearch({
    answer,
    sources,
    searchCount: searches,
    countKind: 'search_calls',
    inputTokens: count(usage['input_tokens']),
    outputTokens: count(usage['output_tokens']),
  })
}
