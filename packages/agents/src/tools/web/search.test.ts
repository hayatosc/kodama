/** Fixed native transports and completion fixtures; never contacts a provider. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { nativeSearch, requireSearchCredential, searchRoute } from './search.ts'
import { readResponses } from './providers/openai.ts'
import { readMessages } from './providers/anthropic.ts'

const models = [
  {
    provider: 'openai',
    api: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    id: 'current-model',
  },
  { provider: 'xai', api: 'openai-responses', baseUrl: 'https://api.x.ai/v1', id: 'current-model' },
  {
    provider: 'anthropic',
    api: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com',
    id: 'current-model',
  },
  {
    provider: 'deepseek',
    api: 'openai-completions',
    baseUrl: 'https://api.deepseek.com',
    id: 'deepseek-current',
  },
  {
    provider: 'google',
    api: 'google-generative-ai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    id: 'gemini/current',
  },
]
const response = {
  type: 'response.completed',
  response: {
    status: 'completed',
    output: [
      {
        type: 'web_search_call',
        status: 'completed',
        action: {
          type: 'search',
          query: 'question',
          sources: [{ url: 'https://example.org/#fragment', title: 'Source' }],
        },
      },
      { type: 'message', content: [{ type: 'output_text', text: 'Answer', annotations: [] }] },
    ],
    usage: { input_tokens: 8, output_tokens: 3 },
  },
}
const messages = [
  { type: 'message_start', message: { usage: { input_tokens: 8 } } },
  {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'server_tool_use', id: 'search', name: 'web_search', input: {} },
  },
  {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'input_json_delta', partial_json: '{"query":"question"}' },
  },
  { type: 'content_block_stop', index: 0 },
  {
    type: 'content_block_start',
    index: 1,
    content_block: {
      type: 'web_search_tool_result',
      tool_use_id: 'search',
      content: [{ type: 'web_search_result', url: 'https://example.org/', title: 'Source' }],
    },
  },
  { type: 'content_block_stop', index: 1 },
  { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Answer' } },
  { type: 'content_block_stop', index: 2 },
  {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn' },
    usage: { output_tokens: 3, server_tool_use: { web_search_requests: 1 } },
  },
  { type: 'message_stop' },
]
const google = {
  candidates: [
    {
      index: 0,
      content: { parts: [{ text: 'Answer' }] },
      finishReason: 'STOP',
      groundingMetadata: {
        webSearchQueries: ['question'],
        groundingChunks: [{ web: { uri: 'https://example.org/', title: 'Source' } }],
        searchEntryPoint: { renderedContent: '<script>SECRET SUGGESTIONS</script>' },
      },
    },
  ],
  usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3 },
}
function stream(events: unknown[]) {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  })
}
afterEach(() => vi.unstubAllGlobals())

it.each([
  undefined,
  {},
  { type: 'search', queries: [] },
  { type: 'search', queries: [''] },
  { type: 'search', queries: 'question' },
  { type: 'search', queries: [null] },
  { type: 'search', query: '' },
  { type: 'search', query: null },
  { type: 'search', query: 1 },
  { type: 'search', query: '', queries: ['question'] },
  { type: 'search', query: 'question', queries: [] },
  { type: 'open_page', url: 'https://example.org/' },
  { type: 'find', url: 'https://example.org/', pattern: 'word' },
])('rejects Responses calls without actual query-search evidence: %j', (action) => {
  const event = {
    ...response,
    response: {
      ...response.response,
      output: [
        { type: 'web_search_call', status: 'completed', action },
        { type: 'message', content: [{ type: 'output_text', text: 'Answer', annotations: [] }] },
      ],
    },
  }
  expect(() => readResponses([JSON.stringify(event)])).toThrow('provider_response_invalid')
})

it.each(models.slice(0, 2))(
  'accepts completed $provider search evidence without optional query disclosure',
  async (model) => {
    const route = searchRoute(model)
    if (!route) throw new Error('Missing native route')
    const fetch = vi.fn(async () =>
      stream([
        {
          ...response,
          response: {
            ...response.response,
            output: [
              {
                type: 'web_search_call',
                status: 'completed',
                action: {
                  type: 'search',
                  sources: [{ url: 'https://example.org/', title: 'Source' }],
                },
              },
              ...response.response.output.slice(1),
            ],
          },
        },
      ]),
    )
    vi.stubGlobal('fetch', fetch)
    const result = await nativeSearch(
      route,
      model,
      'question',
      'fixture-key',
      new AbortController().signal,
      async () => {},
    )
    expect(result.result).toMatchObject({
      answer: 'Answer',
      sources: [{ url: 'https://example.org/', title: 'Source' }],
      searchCount: 1,
      countKind: 'search_calls',
    })
    expect(fetch).toHaveBeenCalledOnce()
  },
)

it.each([
  [
    'orphan delta',
    messages.filter((event) => !(event.type === 'content_block_start' && event.index === 2)),
  ],
  [
    'unclosed block',
    messages.filter((event) => !(event.type === 'content_block_stop' && event.index === 2)),
  ],
  [
    'missing result',
    messages.map((event) =>
      event.type === 'content_block_start' && event.index === 1
        ? {
            ...event,
            content_block: {
              type: 'server_tool_use',
              id: 'unmatched',
              name: 'web_search',
              input: {},
            },
          }
        : event,
    ),
  ],
  [
    'unknown result',
    messages.map((event) =>
      event.type === 'content_block_start' && event.index === 1
        ? { ...event, content_block: { ...event.content_block, tool_use_id: 'unknown' } }
        : event,
    ),
  ],
  [
    'wrong delta index',
    messages.map((event) =>
      event.type === 'content_block_delta' ? { ...event, index: 99 } : event,
    ),
  ],
] as const)('rejects malformed Messages lifecycle: %s', (_name, events) => {
  expect(() => readMessages(events.map((event) => JSON.stringify(event)))).toThrow(
    'provider_response_invalid',
  )
})

it.each(models)(
  'pins $provider transport, model, search evidence and nullable costs',
  async (model) => {
    const route = searchRoute(model)
    if (!route) throw new Error('Missing native route')
    const fetch = vi.fn(async () =>
      stream(
        route.dialect === 'google'
          ? [google]
          : route.dialect === 'responses'
            ? [response]
            : messages,
      ),
    )
    vi.stubGlobal('fetch', fetch)
    const before = vi.fn(async () => {})
    const result = await nativeSearch(
      route,
      model,
      'question',
      'fixture-key',
      new AbortController().signal,
      before,
    )
    expect(result).toMatchObject({
      model: model.id,
      provider: model.provider,
      result: {
        answer: 'Answer',
        sources: [{ url: 'https://example.org/', title: 'Source' }],
        searchCount: 1,
        inputTokens: 8,
        outputTokens: 3,
      },
    })
    expect(JSON.stringify(result)).not.toContain('SUGGESTIONS')
    expect(before).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledOnce()
    const call = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(call?.[0]).not.toContain('fixture-key')
    expect(call?.[1]?.redirect).toBe('manual')
    const body = call?.[1]?.body
    if (typeof body !== 'string') throw new Error('Missing request body')
    expect(body).not.toMatch(/reasoning|thinking|history|memory/)
    if (route.dialect !== 'google') expect(JSON.parse(body)).toMatchObject({ model: model.id })
    else expect(body).toContain('google_search')
    if (model.provider === 'xai') expect(body).not.toContain('.results')
    requireSearchCredential(route, 'api_key')
    if (model.provider !== 'openai')
      expect(() => requireSearchCredential(route, 'oauth_subscription')).toThrow(
        'unsupported_credential_kind',
      )
    expect(searchRoute(model, 'keyless')).toBeUndefined()
    expect(searchRoute({ ...model, baseUrl: 'https://proxy.example.org' })).toBeUndefined()
  },
)

it.each([400, 401, 404, 429, 500])(
  'never retries or falls back after native HTTP %i',
  async (status) => {
    const model = models[0]
    if (!model) throw new Error('Missing fixture')
    const route = searchRoute(model)
    if (!route) throw new Error('Missing fixture')
    const fetch = vi.fn(async () => new Response('private provider error', { status }))
    vi.stubGlobal('fetch', fetch)
    await expect(
      nativeSearch(route, model, 'q', 'fixture', new AbortController().signal, async () => {}),
    ).rejects.toThrow(/provider_/)
    expect(fetch).toHaveBeenCalledOnce()
  },
)

it('refuses partial and answer-only responses, and aborts before traffic', async () => {
  const model = models[0]
  if (!model) throw new Error('Missing fixture')
  const route = searchRoute(model)
  if (!route) throw new Error('Missing fixture')
  const fetch = vi.fn(async () =>
    stream([
      {
        ...response,
        response: { ...response.response, output: response.response.output.slice(1) },
      },
    ]),
  )
  vi.stubGlobal('fetch', fetch)
  await expect(
    nativeSearch(route, model, 'q', 'fixture', new AbortController().signal, async () => {}),
  ).rejects.toThrow('search_not_performed')
  fetch.mockImplementation(async () => stream([{ type: 'response.created' }]))
  await expect(
    nativeSearch(route, model, 'q', 'fixture', new AbortController().signal, async () => {}),
  ).rejects.toThrow('provider_response_invalid')
  fetch.mockClear()
  await expect(
    nativeSearch(route, model, 'q', 'fixture', AbortSignal.abort(), async () => {}),
  ).rejects.toThrow()
  expect(fetch).not.toHaveBeenCalled()
})
