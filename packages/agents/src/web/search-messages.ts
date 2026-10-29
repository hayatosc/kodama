/** Explicit Anthropic and DeepSeek Messages search dialects, with completion and evidence checks. @module */
import { array, count, parseJson, record, text } from './stream.ts'
import { boundedSearch } from './search-result.ts'
import type { SearchSource } from './search-result.ts'

/** Keep DeepSeek translation explicit; its accepted versioned dialect remains a live release gate. */
export function messagesRequest(
  dialect: 'anthropic-messages' | 'deepseek-messages',
  model: string,
  query: string,
) {
  const search =
    dialect === 'anthropic-messages'
      ? {
          type: 'web_search_20260209',
          name: 'web_search',
          max_uses: 3,
          allowed_callers: ['direct'],
        }
      : {
          type: 'web_search_20260209',
          name: 'web_search',
          max_uses: 3,
          allowed_callers: ['direct'],
        }
  return {
    model,
    stream: true,
    max_tokens: 4_096,
    messages: [{ role: 'user', content: query }],
    tools: [search],
  }
}

/** Parse the bounded stream; no pause-turn continuation or retry is issued. */
export function readMessages(events: readonly string[]) {
  let answer = ''
  let started = false
  let stopped = false
  let reason: unknown
  let inputTokens: number | null = null
  let outputTokens: number | null = null
  let searchCount: number | null = null
  const calls = new Set<string>()
  const results = new Set<string>()
  const sources: SearchSource[] = []
  for (const data of events) {
    const event = record(parseJson(data))
    if (stopped) throw new Error('provider_response_invalid')
    switch (event['type']) {
      case 'error':
        throw new Error('provider_response_invalid')
      case 'message_start': {
        if (started) throw new Error('provider_response_invalid')
        started = true
        const message = record(event['message'])
        const usage = record(message['usage'] ?? {})
        inputTokens = count(usage['input_tokens'])
        break
      }
      case 'content_block_start': {
        const block = record(event['content_block'])
        if (block['type'] === 'text') answer += text(block['text'])
        if (block['type'] === 'server_tool_use' && block['name'] === 'web_search')
          calls.add(text(block['id']))
        if (block['type'] === 'web_search_tool_result') {
          results.add(text(block['tool_use_id']))
          for (const item of array(block['content'])) {
            const source = record(item)
            if (source['type'] !== 'web_search_result') throw new Error('provider_response_invalid')
            sources.push({ url: text(source['url']), title: text(source['title'] ?? '') })
          }
        }
        break
      }
      case 'content_block_delta': {
        const delta = record(event['delta'])
        if (delta['type'] === 'text_delta') answer += text(delta['text'])
        if (delta['type'] === 'citations_delta') {
          const citation = record(delta['citation'])
          if (citation['type'] === 'web_search_result_location')
            sources.push({ url: text(citation['url']), title: text(citation['title'] ?? '') })
        }
        break
      }
      case 'message_delta': {
        reason = record(event['delta'])['stop_reason']
        const usage = record(event['usage'] ?? {})
        outputTokens = count(usage['output_tokens'])
        searchCount = count(record(usage['server_tool_use'] ?? {})['web_search_requests'])
        break
      }
      case 'message_stop':
        stopped = true
        break
    }
  }
  if (!started || !stopped || reason !== 'end_turn' || !answer.trim())
    throw new Error('provider_response_invalid')
  if (!calls.size || !results.size || [...results].some((id) => !calls.has(id)))
    throw new Error('search_not_performed')
  return boundedSearch({
    answer,
    sources,
    searchCount,
    countKind: 'provider_requests',
    inputTokens,
    outputTokens,
  })
}
