/** Authenticated local adapter routes registry references without implicit seeding. @module */
import { exports } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import { newAgentId } from '../src/helper/management.ts'
import { seedOnce } from '../src/helper/management.ts'
import { handleCli } from './handler.ts'
import { decodeEvents, useMockModel } from '../src/helper/rpc.ts'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'

useMockModel()

it('creates and addresses an agent by slug before seed', async () => {
  const post = (path: string, body?: unknown) =>
    handleCli(
      new Request(`http://localhost/cli/${path}`, {
        method: 'POST',
        headers: { authorization: 'Bearer test-token' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      'test-token',
      exports.default,
      exports.default,
    )
  expect(await (await post('list')).json()).toEqual([])
  const added = await post('credentials/add', {
    requestId: 'create-first-key',
    provider: 'openai',
    secret: 'create-first-test-key',
  })
  const credential: { credentialId: string } = await added.json()
  const created = await post('create', {
    requestId: 'create-first',
    slug: 'before-seed',
    displayName: 'Before seed',
    credentialIds: [credential.credentialId],
  })
  expect(created.status).toBe(200)
  expect((await post('snapshot/before-seed')).status).toBe(200)
  const sent = await post('send/before-seed', { requestId: 'before-seed-send', content: 'Hello' })
  expect(sent.status).toBe(200)
  expect(await sent.text()).toContain('Hello from Kodama')
  expect((await post('cancel/before-seed')).status).toBe(200)
})

it('authenticates the CLI adapter and sends through real Durable Object RPC', async () => {
  const agentId = await newAgentId()
  const url = `http://localhost/cli/send/${agentId}`
  const message = { requestId: 'cli-send', content: 'Hello from CLI' }
  const denied = await handleCli(
    new Request(url, { method: 'POST' }),
    'test-token',
    exports.default,
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
    exports.default,
  )
  expect(response.status).toBe(400)
})

it('seeds, and sends to the first agent by its slug', async () => {
  await seedOnce()
  const post = (path: string, body?: unknown) =>
    handleCli(
      new Request(`http://localhost/cli/${path}`, {
        method: 'POST',
        headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      'test-token',
      exports.default,
      exports.default,
    )
  const seeded = await (await post('seed')).json()
  expect(seeded).toMatchObject({ installId: expect.any(String) })
  const sent = await post('send/assistant', { requestId: 'by-slug', content: 'Hello' })
  expect(sent.status).toBe(200)
  expect(JSON.stringify(decodeEvents(await sent.text()))).toContain('Hello from Kodama')
  const unknown = await post('snapshot/no-such-agent')
  expect(unknown.status).toBe(400)
})
