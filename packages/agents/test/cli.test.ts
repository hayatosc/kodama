import { exports } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import { handleCli } from '../cli/handler.ts'
import { decodeEvents, useMockModel } from './helpers/rpc.ts'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'

useMockModel()

it('authenticates the CLI adapter and sends through real Durable Object RPC', async () => {
  const agentId = crypto.randomUUID()
  const url = `http://localhost/cli/send/${agentId}`
  const message = { requestId: 'cli-send', content: 'Hello from CLI' }
  const denied = await handleCli(
    new Request(url, { method: 'POST' }),
    'test-token',
    exports.default,
  )
  expect(denied.status).toBe(401)
  expect((await exports.default.snapshot(agentId)).snapshot.messages).toEqual([])
  const response = await handleCli(
    new Request(url, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify(message),
    }),
    'test-token',
    exports.default,
  )
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('text/event-stream')
  const events = decodeEvents(await response.text())
  expect(events.at(-1)).toMatchObject({ type: 'submission', data: { record: { status: 'done' } } })
  expect(JSON.stringify(events)).toContain('Hello from Kodama')
  const snapshot = await handleCli(
    new Request(`http://localhost/cli/snapshot/${agentId}`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token' },
    }),
    'test-token',
    exports.default,
  )
  expect(await snapshot.text()).toContain('Hello from CLI')
  const cancelled = await handleCli(
    new Request(`http://localhost/cli/cancel/${agentId}`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token' },
    }),
    'test-token',
    exports.default,
  )
  expect(await cancelled.json()).toEqual({ cancelled: true })
})

it('rejects malformed CLI input before RPC admission', async () => {
  const response = await handleCli(
    new Request('http://localhost/cli/send/test', {
      method: 'POST',
      headers: { authorization: 'Bearer test-token' },
      body: '{}',
    }),
    'test-token',
    exports.default,
  )
  expect(response.status).toBe(400)
})
