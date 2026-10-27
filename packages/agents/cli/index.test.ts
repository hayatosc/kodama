/**
 * Exercise the real Node CLI entrypoint, including argument parsing and exit handling.
 * Only filesystem token access and HTTP transport are mocked.
 *
 * @module
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { USAGE } from './command.ts'
import { readLocalToken } from './token.ts'

const prompt = vi.hoisted(() => vi.fn<() => Promise<string>>())
vi.mock('node:readline/promises', () => ({
  createInterface: () => ({ question: prompt, once() {}, close() {} }),
}))

vi.mock('./token.ts', () => ({ readLocalToken: vi.fn(() => 'local-secret') }))

const originalArgv = process.argv
const originalExitCode = process.exitCode
const fetchMock = vi.fn<typeof fetch>()
const writeMock = vi.fn<typeof process.stdout.write>()

beforeEach(() => {
  vi.resetModules()
  vi.mocked(readLocalToken).mockReset().mockReturnValue('local-secret')
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  writeMock.mockReset().mockReturnValue(true)
  vi.spyOn(process.stdout, 'write').mockImplementation(writeMock)
  process.exitCode = undefined
})

afterEach(() => {
  process.argv = originalArgv
  process.exitCode = originalExitCode
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

async function run(...args: string[]) {
  process.argv = ['node', 'cli/index.ts', ...args]
  await import('./index.ts')
}

describe('CLI entrypoint', () => {
  it('preserves safe command errors while refusing unsupported login providers', async () => {
    await run('credentials', 'login', '--provider', 'xai')
    expect(process.exitCode).toBe(1)
    expect(console.error).toHaveBeenCalledWith('ChatGPT login requires --provider openai')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('logs in and registers OAuth before any seed, using a lazy installation identity', async () => {
    const id = '019a0000-0000-7000-8000-000000000001'
    fetchMock.mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url.endsWith('/credentials/installation')) return Response.json({ installId: id })
      if (url.endsWith('/credentials/add')) return Response.json({ credentialId: id })
      if (url.startsWith('https://auth.openai.com/'))
        return Response.json({
          access_token: 'oauth-only-access',
          refresh_token: 'oauth-only-refresh',
          id_token: 'test-id-token',
          expires_in: 3600,
          scope: 'openid chatgpt.tokens.use.direct',
        })
      throw new Error('Unexpected endpoint')
    })
    prompt.mockImplementation(async () => {
      const message: unknown = vi
        .mocked(console.error)
        .mock.calls.find(
          ([value]) => typeof value === 'string' && value.startsWith('Open in your browser:'),
        )?.[0]
      if (typeof message !== 'string') throw new Error('Missing authorization URL')
      const url = new URL(message.replace('Open in your browser: ', ''))
      expect(url.searchParams.get('ext_agent_host_id')).toBe(`urn:uuid:${id}`)
      return `http://127.0.0.1:1455/auth/callback?code=test-code&state=${url.searchParams.get('state')}&client_id=issued-client`
    })
    await run('credentials', 'login', '--provider', 'openai')
    expect(process.exitCode, JSON.stringify(vi.mocked(console.error).mock.calls)).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:5173/cli/credentials/add',
      expect.objectContaining({ body: expect.stringContaining('oauth_subscription') }),
    )
    expect(
      fetchMock.mock.calls.some(([url]) =>
        (url instanceof Request ? url.url : url.toString()).endsWith('/seed'),
      ),
    ).toBe(false)
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain('oauth-only-access')
  })

  it('registers an explicit environment key without printing it, even on a reflecting HTTP error', async () => {
    vi.stubEnv('CLI_TEST_KEY', 'private-test-api-key')
    fetchMock.mockResolvedValue(new Response('private-test-api-key', { status: 400 }))
    await run('credentials', 'add', '--provider', 'openai', '--key-from-env', 'CLI_TEST_KEY')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:5173/cli/credentials/add',
      expect.objectContaining({ body: expect.stringContaining('private-test-api-key') }),
    )
    expect(process.exitCode).toBe(1)
    expect(console.log).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith(
      'Credential operation failed (400); check the local Worker, KEK and input.',
    )
  })

  it('does not echo an accidentally supplied key argument', async () => {
    await run('credentials', 'add', '--provider', 'openai', '--key', 'private-test-api-key')
    expect(console.error).toHaveBeenCalledWith(
      'Invalid arguments. See nr agent --help; never pass credentials as arguments.',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('prints help without reading credentials or connecting', async () => {
    await run('--help')
    expect(console.log).toHaveBeenCalledWith(USAGE)
    expect(readLocalToken).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBeUndefined()
  })

  it.each([['--unknown'], ['send', 'assistant'], ['bogus']])(
    'rejects invalid arguments %j before connecting',
    async (...args) => {
      await run(...args)
      expect(process.exitCode).toBe(1)
      expect(console.error).toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('reports a missing token without connecting', async () => {
    vi.mocked(readLocalToken).mockImplementation(() => {
      throw new Error('Start the local Worker first: nr dev:agents')
    })
    await run('seed')
    expect(console.error).toHaveBeenCalledWith('Start the local Worker first: nr dev:agents')
    expect(process.exitCode).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['seed', 'snapshot', 'cancel'])('posts %s and prints its result', async (action) => {
    fetchMock.mockResolvedValue(Response.json({ ok: true }))
    await run(action, ...(action === 'seed' ? [] : ['assistant']))
    expect(fetchMock).toHaveBeenCalledWith(
      `http://127.0.0.1:5173/cli/${action}${action === 'seed' ? '' : '/assistant'}`,
      expect.objectContaining({
        method: 'POST',
        headers: { authorization: 'Bearer local-secret', 'content-type': 'application/json' },
        redirect: 'error',
      }),
    )
    expect(console.log).toHaveBeenCalledWith(JSON.stringify({ ok: true }, null, 2))
    expect(process.exitCode).toBeUndefined()
  })

  it('reports connection failures', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    await run('seed')
    expect(console.error).toHaveBeenCalledWith(
      'Cannot reach the local Worker. Start nr dev:agents first.',
    )
    expect(process.exitCode).toBe(1)
  })

  it('reports HTTP errors without claiming success', async () => {
    fetchMock.mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    await run('seed')
    expect(console.error).toHaveBeenCalledWith('RPC failed (401): Unauthorized')
    expect(console.log).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('rejects a missing stream', async () => {
    fetchMock.mockResolvedValue(new Response(null))
    await run('send', 'assistant', 'Hello', '--request-id', 'r1')
    expect(console.error).toHaveBeenCalledWith('Missing agent response stream')
    expect(process.exitCode).toBe(1)
  })

  it('sends the message and prints streamed events', async () => {
    const event = { type: 'submission', record: { status: 'done' } }
    fetchMock.mockResolvedValue(new Response(`data: ${JSON.stringify(event)}\n\n`))
    await run('send', 'assistant', 'Hello', '--request-id', 'r1', '--steer', '--events')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:5173/cli/send/assistant',
      expect.objectContaining({
        body: JSON.stringify({ requestId: 'r1', content: 'Hello', whenBusy: 'steer' }),
      }),
    )
    expect(writeMock).toHaveBeenCalledWith(`${JSON.stringify(event)}\n`)
    expect(console.error).toHaveBeenCalledWith('Completed. History: nr agent snapshot assistant')
    expect(process.exitCode).toBeUndefined()
  })
})
