/** Mock OpenAI Responses streams for workerd tests. */

type SseEvent = { type: string; [field: string]: unknown }

function stream(events: readonly SseEvent[]): Response {
  const body = events
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('')
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
}

const usage = { input_tokens: 5, output_tokens: 4, total_tokens: 9 }

export function textResponse(text: string): Response {
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
      response: { id: 'resp_test', status: 'completed', output: [item], usage },
    },
  ])
}

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

export function requestBody(init: RequestInit | undefined): string {
  return typeof init?.body === 'string' ? init.body : ''
}

/** How many tool results the request already carries: the step of a scripted tool loop. */
export function toolResults(body: string): number {
  return body.split('"function_call_output"').length - 1
}

/** Requests of the memory agent carry its system prompt. */
export function isMemoryAgentRequest(body: string): boolean {
  return body.includes('You keep the long-term memory of the Kodama agents')
}
