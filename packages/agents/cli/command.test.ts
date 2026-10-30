/**
 * CLI arguments become commands, and each command the adapter request it needs.
 *
 * @module
 */
import { describe, expect, it } from 'vitest'
import { commandRequest, LOCAL_WORKER_URL, toCommand } from './command.ts'

const agentId = '0190a8e2-5f1c-7a3b-8c4d-123456789abc'

/** The command of positional arguments and options, as `parseArgs` returns them. */
function command(positionals: string[], values: Parameters<typeof toCommand>[0]['values'] = {}) {
  return toCommand({ positionals, values }, () => 'generated')
}

describe('toCommand', () => {
  it('sets the full optional tool selection, including an empty selection', () => {
    expect(command(['tools', 'assistant', 'contact_agent'])).toEqual({
      action: 'tools',
      agentRef: 'assistant',
      tools: ['contact_agent'],
      requestId: 'generated',
    })
    const disabled = command(['tools', 'assistant'])
    if (disabled.action !== 'tools') throw new Error('Expected tools command')
    expect(commandRequest(disabled, 'local-token').init.body).toBe(
      JSON.stringify({ tools: [], requestId: 'generated' }),
    )
  })
  it('parses agent visibility, creation and credential management commands', () => {
    expect(command(['list'])).toEqual({ action: 'list' })
    expect(command(['create', 'second'], { name: 'Second agent' })).toEqual({
      action: 'create',
      request: { requestId: 'generated', slug: 'second', displayName: 'Second agent' },
    })
    expect(
      command(['credentials', 'add'], { provider: 'openai', 'key-from-env': 'OPENAI_API_KEY' }),
    ).toEqual({
      action: 'credentials/add',
      provider: 'openai',
      keyFromEnv: 'OPENAI_API_KEY',
      requestId: 'generated',
    })
    expect(command(['credentials', 'login'], { provider: 'openai' })).toEqual({
      action: 'credentials/login',
      provider: 'openai',
      requestId: 'generated',
    })
    expect(command(['credentials', 'list'])).toEqual({ action: 'credentials/list' })
    for (const action of ['assign', 'unassign'])
      expect(command(['credentials', action, agentId, 'second'])).toEqual({
        action: `credentials/${action}`,
        credentialId: agentId,
        agentRef: 'second',
      })
    expect(command(['credentials', 'revoke', agentId])).toEqual({
      action: 'credentials/revoke',
      credentialId: agentId,
    })
    expect(() => command(['credentials', 'add'], {})).toThrow()
    expect(() => command(['credentials', 'login'], { provider: 'xai' })).toThrow()
  })

  it('preserves credential-shaped registration request IDs without rewriting their identity', () => {
    const requestId = `sk-${'x'.repeat(32)}`
    for (const action of ['add', 'login']) {
      expect(
        command(['credentials', action], { provider: 'openai', 'request-id': requestId }),
      ).toMatchObject({ requestId })
    }
  })

  it('sends credentials only in the body, never a path or redirect', () => {
    const parsed = command(['credentials', 'add'], { provider: 'openai' })
    if (parsed.action === 'help') throw new Error('Unexpected help')
    const request = commandRequest(parsed, 'token', '{"secret":"private-key"}')
    expect(request.url).toBe(`${LOCAL_WORKER_URL}/cli/credentials/add`)
    expect(request.init.body).toBe('{"secret":"private-key"}')
    expect(request.init.redirect).toBe('error')
  })
  it('asks for help with no arguments or --help', () => {
    expect(command([])).toEqual({ action: 'help' })
    expect(command(['send', 'assistant', 'Hi'], { help: true })).toEqual({ action: 'help' })
  })

  it('accepts local credential bootstrap without putting keys in arguments or the URL', () => {
    const parsed = command(['dev', 'seed-credentials'])
    expect(parsed).toEqual({ action: 'dev/seed-credentials' })
    if (parsed.action !== 'dev/seed-credentials') throw new Error('Unexpected command')
    const request = commandRequest(parsed, 'local-token', '{"openai":"opaque-provider-key"}')
    expect(request.url).toBe('http://127.0.0.1:5173/cli/dev/seed-credentials')
    expect(request.init.body).toBe('{"openai":"opaque-provider-key"}')
  })

  it('reads seed, snapshot, and cancel', () => {
    expect(command(['seed'])).toEqual({ action: 'seed' })
    expect(command(['snapshot', 'assistant'])).toEqual({
      action: 'snapshot',
      agentRef: 'assistant',
    })
    expect(command(['cancel', agentId])).toEqual({ action: 'cancel', agentRef: agentId })
  })

  it('reads a message with its request ID, steering, and event output', () => {
    expect(
      command(['send', 'assistant', 'Hello'], { 'request-id': 'r1', steer: true, events: true }),
    ).toEqual({
      action: 'send',
      agentRef: 'assistant',
      message: { requestId: 'r1', content: 'Hello', whenBusy: 'steer' },
      events: true,
    })
    expect(command(['send', 'assistant', 'Hello'])).toEqual({
      action: 'send',
      agentRef: 'assistant',
      message: { requestId: 'generated', content: 'Hello', whenBusy: 'followUp' },
      events: false,
    })
  })

  it('generates a canonical v7 request ID by default', () => {
    const result = toCommand({ positionals: ['send', 'assistant', 'Hello'], values: {} })
    expect(result).toMatchObject({
      action: 'send',
      message: {
        requestId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
      },
    })
  })

  it.each([
    [['deploy'], /Expected seed, send, snapshot, or cancel/],
    [['seed', 'assistant'], /Unexpected arguments/],
    [['send', 'assistant'], /Unexpected arguments/],
    [['snapshot', 'Not A Ref!'], TypeError],
    [['send', 'assistant', ''], TypeError],
  ])('refuses %j', (positionals, error) => {
    expect(() => command(positionals)).toThrow(error)
  })
})

describe('commandRequest', () => {
  it('posts each command to its adapter path with the token', () => {
    const send = commandRequest(
      {
        action: 'send',
        agentRef: 'assistant',
        message: { requestId: 'r1', content: 'Hello', whenBusy: 'followUp' },
        events: false,
      },
      'secret',
    )
    const seed = commandRequest({ action: 'seed' }, 'secret')

    expect(send).toEqual({
      url: `${LOCAL_WORKER_URL}/cli/send/assistant`,
      init: {
        method: 'POST',
        headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: 'r1', content: 'Hello', whenBusy: 'followUp' }),
        redirect: 'error',
      },
    })
    expect(seed).toMatchObject({ url: `${LOCAL_WORKER_URL}/cli/seed`, init: { body: undefined } })
  })
})

it('carries repeatable owner URLs through send without changing replacement tools', () => {
  const parsed = command(['send', 'assistant', 'Question'], {
    'web-url': ['HTTPS://Example.org:443/page#fragment', 'https://example.org/second'],
  })
  if (parsed.action !== 'send') throw new Error('Expected send')
  expect(parsed.message.webPermissions).toEqual({
    urls: ['https://example.org/page', 'https://example.org/second'],
  })
  const body = commandRequest(parsed, 'local-token').init.body
  if (typeof body !== 'string') throw new Error('Missing body')
  expect(JSON.parse(body)).toMatchObject({
    webPermissions: parsed.message.webPermissions,
  })
  expect(() =>
    command(['send', 'assistant', 'Question'], { 'web-url': ['http://127.0.0.1/'] }),
  ).toThrow()
  expect(() =>
    command(['send', 'assistant', 'Question'], {
      'web-url': Array.from({ length: 21 }, (_, index) => `https://example.org/${index}`),
    }),
  ).toThrow()
})
