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
  it('parses native OAuth options and routes client configuration through authenticated RPC', () => {
    expect(
      command(['mcp', 'login', agentId], {
        'callback-port': '49152',
        issuer: 'https://as.example.com',
        scope: 'read',
      }),
    ).toMatchObject({
      action: 'mcp',
      operation: 'login',
      serverId: agentId,
      callbackPort: 49152,
      issuer: 'https://as.example.com',
      scope: 'read',
      stdin: false,
    })
    expect(command(['mcp', 'login', agentId])).toMatchObject({ callbackPort: 0 })
    for (const port of ['-1', '80', '65536', '1.5', 'oops'])
      expect(() => command(['mcp', 'login', agentId], { 'callback-port': port })).toThrow(
        'Callback port',
      )
    const client = command(['mcp', 'client-loopback'])
    if (client.action !== 'mcp') throw new Error('Expected MCP')
    expect(commandRequest(client, 'token', '{}').url).toBe(`${LOCAL_WORKER_URL}/cli/mcp/auth`)
  })
  it('routes MCP management and secret input without accepting secrets in argv', () => {
    expect(command(['mcp', 'list'])).toEqual({ action: 'mcp', operation: 'list', stdin: false })
    const request = (operation: string, text: string) => {
      const parsed = command(['mcp', operation])
      if (parsed.action !== 'mcp') throw new Error('Expected MCP command')
      return commandRequest(parsed, 'fixture-dev-token', text)
    }
    const bearer = request('bearer', JSON.stringify({ serverId: agentId, secret: 'stdin-only' }))
    expect(bearer.url).toContain('/cli/mcp/manage')
    const client = request('client', JSON.stringify({ serverId: agentId }))
    expect(client.url).toContain('/cli/mcp/auth')
    expect(() => command(['mcp', 'bearer', 'argv-secret'])).toThrow()
    expect(() => request('assign', '[]')).toThrow('MCP input must be an object')
  })
  it('parses artifact commands and sends bytes as multipart rather than JSON strings', async () => {
    const upload = command(['artifacts', 'upload', 'assistant', '/tmp/image.png'], {
      'media-type': 'image/png',
    })
    expect(upload).toEqual({
      action: 'artifact-upload',
      agentRef: 'assistant',
      path: '/tmp/image.png',
      mediaType: 'image/png',
    })
    if (upload.action !== 'artifact-upload') throw new Error('Expected upload')
    const request = commandRequest(upload, 'token', undefined, {
      filename: 'image.png',
      bytes: new Uint8Array([0, 255, 128]),
    })
    expect(request.url).toBe(`${LOCAL_WORKER_URL}/cli/artifact-upload/assistant`)
    const form = request.init.body
    if (!(form instanceof FormData)) throw new Error('Expected multipart body')
    const file = form.get('file')
    if (!file || typeof file === 'string') throw new Error('Expected binary form file')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([0, 255, 128]))
    expect(command(['artifacts', 'list', 'assistant'], { cursor: 'id', limit: '2' })).toEqual({
      action: 'artifact-list',
      agentRef: 'assistant',
      cursor: 'id',
      limit: 2,
    })
    expect(command(['artifacts', 'download', 'assistant', 'id', 'new.zip'])).toEqual({
      action: 'artifact-download',
      agentRef: 'assistant',
      artifactId: 'id',
      path: 'new.zip',
    })
    expect(command(['artifacts', 'delete', 'assistant', 'id'])).toEqual({
      action: 'artifact-delete',
      agentRef: 'assistant',
      artifactId: 'id',
    })
    expect(() => command(['artifacts', 'list', 'assistant'], { limit: '101' })).toThrow()
    expect(() => command(['artifacts', 'download', 'assistant', '../key', 'x'])).toThrow()
    expect(() => command(['artifacts', 'download', 'assistant', 'id'])).toThrow()
  })
  it('omits an absent artifact cursor but rejects an explicitly empty one', () => {
    expect(command(['artifacts', 'list', 'assistant'])).toEqual({
      action: 'artifact-list',
      agentRef: 'assistant',
    })
    expect(() => command(['artifacts', 'list', 'assistant'], { cursor: '' })).toThrow(TypeError)
  })

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

  it('lists notifications and acknowledges exact sequences with validated bounded arguments', () => {
    const parsed = command(['notifications', 'assistant'], {
      before: '42',
      limit: '2',
      unread: true,
    })
    expect(parsed).toEqual({
      action: 'notifications',
      agentRef: 'assistant',
      query: { before: 42, limit: 2, unreadOnly: true },
    })
    if (parsed.action !== 'notifications') throw new Error('Unexpected command')
    expect(commandRequest(parsed, 'token')).toMatchObject({
      url: `${LOCAL_WORKER_URL}/cli/notifications/assistant`,
      init: { body: JSON.stringify(parsed.query) },
    })
    const read = command(['notification-read', 'assistant', '41'])
    expect(read).toEqual({
      action: 'notification-read',
      agentRef: 'assistant',
      request: { seq: 41 },
    })
    if (read.action !== 'notification-read') throw new Error('Unexpected command')
    expect(commandRequest(read, 'token')).toMatchObject({
      url: `${LOCAL_WORKER_URL}/cli/notification-read/assistant`,
      init: { body: '{"seq":41}' },
    })
    for (const value of ['0', '-1', '1.5', 'abc', '9007199254740992']) {
      expect(() => command(['notification-read', 'assistant', value])).toThrow()
      expect(() => command(['notifications', 'assistant'], { before: value })).toThrow()
    }
    for (const limit of ['0', '101', '1.5', 'abc'])
      expect(() => command(['notifications', 'assistant'], { limit })).toThrow()
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
    [['deploy'], /Invalid command or arguments; see nr agent --help/],
    [['notifications'], /Invalid command or arguments; see nr agent --help/],
    [['notification-read', 'assistant'], /Invalid command or arguments; see nr agent --help/],
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
