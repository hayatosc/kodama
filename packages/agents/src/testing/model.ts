/**
 * Mock OpenAI Responses streams for workerd tests.
 *
 * @module
 */

type SseEvent = { type: string; [field: string]: unknown }

function stream(events: readonly SseEvent[]): Response {
  const body = events
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('')
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
}

const usage = { input_tokens: 5, output_tokens: 4, total_tokens: 9 }

/** A response that reports `inputTokens` of context, which drives Pi's compaction thresholds. */
export function textResponse(text: string, inputTokens = usage.input_tokens): Response {
  const reported = { input_tokens: inputTokens, output_tokens: 4, total_tokens: inputTokens + 4 }
  const item = {
    type: 'message',
    id: 'msg_test',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }],
  }
  return stream([
    { type: 'response.created', response: { id: 'resp_test' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: text },
    { type: 'response.output_item.done', output_index: 0, item },
    {
      type: 'response.completed',
      response: { id: 'resp_test', status: 'completed', output: [item], usage: reported },
    },
  ])
}

/** A tool call a scripted model makes. */
export interface ToolCall {
  name: string
  arguments: Record<string, unknown>
}

/** A response that calls one tool. */
export function toolCallResponse(call: ToolCall): Response {
  const id = `fc_${crypto.randomUUID().replaceAll('-', '')}`
  const callId = `call_${crypto.randomUUID().replaceAll('-', '')}`
  const args = JSON.stringify(call.arguments)
  const item = {
    type: 'function_call',
    id,
    call_id: callId,
    name: call.name,
    arguments: args,
    status: 'completed',
  }
  return stream([
    { type: 'response.created', response: { id: 'resp_tool' } },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { ...item, arguments: '', status: 'in_progress' },
    },
    { type: 'response.function_call_arguments.delta', output_index: 0, item_id: id, delta: args },
    {
      type: 'response.function_call_arguments.done',
      output_index: 0,
      item_id: id,
      arguments: args,
    },
    { type: 'response.output_item.done', output_index: 0, item },
    {
      type: 'response.completed',
      response: { id: 'resp_tool', status: 'completed', output: [item], usage },
    },
  ])
}

/** The JSON body of a mocked `fetch` request, or empty. */
export function requestBody(init: RequestInit | undefined): string {
  return typeof init?.body === 'string' ? init.body : ''
}

/** How many tool results the request already carries: the step of a scripted tool loop. */
export function toolResults(body: string): number {
  return body.split('"function_call_output"').length - 1
}

/** Pi's compaction asks the model to summarize the conversation. */
export function isSummaryRequest(body: string): boolean {
  return body.includes('The messages above are a conversation to summarize')
}

/** Requests of the memory agent carry its system prompt. */
export function isMemoryAgentRequest(body: string): boolean {
  return body.includes('You keep the long-term memory of the Kodama agents')
}
