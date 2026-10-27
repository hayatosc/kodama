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
