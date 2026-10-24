/**
 * Exercise the real Node CLI entrypoint, including argument parsing and exit handling.
 * Only filesystem token access and HTTP transport are mocked.
 *
 * @module
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { USAGE } from './command.ts'
import { readLocalToken } from './token.ts'

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
})

async function run(...args: string[]) {
  process.argv = ['node', 'cli/index.ts', ...args]
  await import('./index.ts')
}

describe('CLI entrypoint', () => {
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
