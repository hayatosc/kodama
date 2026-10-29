/** Fixed MCP tools/call response decoding, never an arbitrary-server client. @module */
import { array, parseJson, record, sseData, text } from '../stream.ts'

/** Require the corresponding terminal JSON-RPC result, not progress or notifications. */
export function mcpResult(body: string, contentType: string, id: number): Record<string, unknown> {
  const events = contentType.toLowerCase().startsWith('text/event-stream')
    ? sseData(body).map(parseJson)
    : [parseJson(body)]
  let result: Record<string, unknown> | undefined
  for (const value of events) {
    const event = record(value)
    if (event['jsonrpc'] !== '2.0') throw new Error('provider_response_invalid')
    if (event['id'] === undefined && typeof event['method'] === 'string') continue
    if (event['id'] !== id || event['error'] !== undefined || result)
      throw new Error('provider_response_invalid')
    result = record(event['result'])
    if (result['isError'] !== undefined && result['isError'] !== false)
      throw new Error('provider_response_invalid')
  }
  if (!result) throw new Error('provider_response_invalid')
  return result
}

/** Read only declared text blocks; arbitrary prose is never searched for URLs. */
export function mcpText(result: Record<string, unknown>): string {
  return array(result['content'])
    .map((value) => {
      const block = record(value)
      if (block['type'] !== 'text') throw new Error('provider_response_invalid')
      return text(block['text'])
    })
    .join('\n')
}
