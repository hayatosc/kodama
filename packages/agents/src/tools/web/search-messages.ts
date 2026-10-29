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
  const blocks = new Map<number, string>()
  let nextIndex = 0
  let terminal = false
  for (const data of events) {
    const event = record(parseJson(data))
    if (stopped || (!started && !['message_start', 'ping'].includes(text(event['type']))))
      throw new Error('provider_response_invalid')
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
        const index = count(event['index'])
        if (terminal || index !== nextIndex || blocks.size)
          throw new Error('provider_response_invalid')
        const block = record(event['content_block'])
        const type = text(block['type'])
        blocks.set(index, type)
        nextIndex++
        if (type === 'text') answer += text(block['text'])
        if (type === 'server_tool_use') {
          const id = text(block['id'])
          if (block['name'] !== 'web_search' || !id || calls.has(id))
            throw new Error('provider_response_invalid')
          calls.add(id)
        }
        if (type === 'web_search_tool_result') {
          const id = text(block['tool_use_id'])
          if (!calls.has(id) || results.has(id)) throw new Error('provider_response_invalid')
          results.add(id)
          for (const item of array(block['content'])) {
            const source = record(item)
            if (source['type'] !== 'web_search_result') throw new Error('provider_response_invalid')
            sources.push({ url: text(source['url']), title: text(source['title'] ?? '') })
          }
        }
        break
      }
      case 'content_block_delta': {
        const index = count(event['index'])
        const type = index === null ? undefined : blocks.get(index)
        const delta = record(event['delta'])
        const expected =
          delta['type'] === 'input_json_delta'
            ? 'server_tool_use'
            : delta['type'] === 'thinking_delta' || delta['type'] === 'signature_delta'
              ? 'thinking'
              : delta['type'] === 'text_delta' || delta['type'] === 'citations_delta'
                ? 'text'
                : undefined
        if (!type || !expected || type !== expected || terminal)
          throw new Error('provider_response_invalid')
        if (delta['type'] === 'text_delta') answer += text(delta['text'])
        if (delta['type'] === 'citations_delta') {
          const citation = record(delta['citation'])
          if (citation['type'] === 'web_search_result_location')
            sources.push({ url: text(citation['url']), title: text(citation['title'] ?? '') })
        }
        break
      }
      case 'content_block_stop': {
        const index = count(event['index'])
        if (index === null || !blocks.delete(index) || terminal)
          throw new Error('provider_response_invalid')
        break
      }
      case 'message_delta': {
        if (blocks.size || terminal) throw new Error('provider_response_invalid')
        terminal = true
        reason = record(event['delta'])['stop_reason']
        const usage = record(event['usage'] ?? {})
        outputTokens = count(usage['output_tokens'])
        searchCount = count(record(usage['server_tool_use'] ?? {})['web_search_requests'])
        break
      }
      case 'message_stop':
        if (!terminal || blocks.size) throw new Error('provider_response_invalid')
        stopped = true
        break
      case 'ping':
        break
      default:
        throw new Error('provider_response_invalid')
    }
  }
  if (!started || !stopped || reason !== 'end_turn' || !answer.trim())
    throw new Error('provider_response_invalid')
  if (!calls.size) throw new Error('search_not_performed')
  if (calls.size !== results.size || [...calls].some((id) => !results.has(id)))
    throw new Error('provider_response_invalid')
  return boundedSearch({
    answer,
    sources,
    searchCount,
    countKind: 'provider_requests',
    inputTokens,
    outputTokens,
  })
}
