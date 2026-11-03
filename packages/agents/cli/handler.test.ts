/** Authenticated local adapter routes registry references without implicit seeding. @module */
import { env, exports } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import { recordNotification } from '../src/agent/local-db/notifications.ts'
import { openLocalDb } from '../src/agent/local-db/local.ts'
import { expect, it } from 'vitest'
import { newAgentId } from '../src/testing/management.ts'
import { seedOnce } from '../src/testing/management.ts'
import { waitForAnswer } from '../src/testing/rpc.ts'
import { handleCli } from './handler.ts'
import { decodeEvents, useMockModel } from '../src/testing/rpc.ts'
// Load the provider before RPC calls so Vite's module fetch is outside a short-lived DO request.
import '@earendil-works/pi-ai/api/openai-responses'

useMockModel()

it('uses ordinary sends for replies without a UI delivery ledger', async () => {
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
  const credential = await (
    await post('credentials/add', {
      requestId: 'round-trip-key',
      provider: 'openai',
      secret: 'round-trip-test-key',
    })
  ).json<{ credentialId: string }>()
  const agent = await (
    await post('create', {
      requestId: 'round-trip-create',
      slug: 'round-trip',
      displayName: 'Round trip',
      credentialIds: [credential.credentialId],
    })
  ).json<{ agentId: string }>()
  const input = {
    requestId: 'round-trip-1',
    whenBusy: 'followUp',
    content: 'Hello',
  }
  expect((await post('send/round-trip', input)).status).toBe(200)
  expect((await post('send/round-trip', input)).status).toBe(200)
  await waitForAnswer(agent.agentId, input.requestId)
  for (const removed of ['owner-reply', 'deliveries', 'delivery-report'])
    expect((await post(`${removed}/round-trip`, input)).status).toBe(404)
  const second = {
    requestId: 'round-trip-2',
    whenBusy: 'steer',
    content: 'Thanks',
  }
  expect((await post('send/round-trip', second)).status).toBe(200)
  await waitForAnswer(agent.agentId, second.requestId)
  expect((await post('attention/round-trip')).status).toBe(200)
  expect(
    (
      await handleCli(
        new Request('http://localhost/cli/send/round-trip', {
          method: 'POST',
          headers: { authorization: 'Bearer impostor' },
          body: JSON.stringify(second),
        }),
        'test-token',
        exports.default,
        exports.default,
      )
    ).status,
  ).toBe(401)
})

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
  expect(await (await post('list')).json()).not.toContainEqual(
    expect.objectContaining({ slug: 'assistant' }),
  )
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

it('uploads arbitrary binary data and downloads it only as a non-executable attachment', async () => {
  const owner = await newAgentId()
  const call = (action: string, body: BodyInit, headers: Record<string, string> = {}) =>
    handleCli(
      new Request(`http://localhost/cli/artifact-${action}/${owner}`, {
        method: 'POST',
        headers: { authorization: 'Bearer test-token', ...headers },
        body,
      }),
      'test-token',
      exports.default,
      exports.default,
    )
  const bytes = new Uint8Array([80, 75, 5, 6, 0, 255, 128])
  const form = new FormData()
  form.set('filename', 'data.zip')
  form.set('mediaType', 'application/zip')
  form.set('file', new Blob([bytes]))
  const uploaded = await call('upload', form)
  expect(uploaded.status).toBe(200)
  const file: { artifactId: string } = await uploaded.json()
  expect(await (await call('list', '{}')).json()).toMatchObject([
    { artifactId: file.artifactId, filename: 'data.zip', size: bytes.length },
  ])
  const download = await call('download', JSON.stringify({ artifactId: file.artifactId }))
  expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes)
  expect(download.headers.get('content-type')).toBe('application/octet-stream')
  expect(download.headers.get('content-disposition')).toContain('attachment')
  expect(download.headers.get('x-content-type-options')).toBe('nosniff')
  expect(download.headers.get('content-security-policy')).toContain('sandbox')
  const html = new FormData()
  html.set('filename', 'active.html')
  html.set('mediaType', 'text/html')
  html.set('file', new Blob(['<script>throw new Error("never rendered")</script>']))
  const active: { artifactId: string } = await (await call('upload', html)).json()
  const safe = await call('download', JSON.stringify({ artifactId: active.artifactId }))
  expect(safe.headers.get('content-type')).toBe('application/octet-stream')
  expect(safe.headers.get('content-disposition')).toContain('attachment')
  expect(
    await (await call('delete', JSON.stringify({ artifactId: file.artifactId }))).json(),
  ).toEqual({ deleted: true })
})

it('rejects oversized upload streams before multipart decoding', async () => {
  const owner = await newAgentId()
  const response = await handleCli(
    new Request(`http://localhost/cli/artifact-upload/${owner}`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token' },
      body: new Uint8Array(10 * 1024 * 1024 + 64 * 1024 + 1),
    }),
    'test-token',
    exports.default,
    exports.default,
  )
  expect(response.status).toBe(400)
  expect(await exports.default.listArtifacts(owner)).toEqual([])
})

it('authenticates inbox reads and exact acknowledgements and validates their request bodies', async () => {
  const id = await newAgentId()
  await runInDurableObject(env.AGENTS.getByName(id), async (_instance, state) => {
    recordNotification(
      await openLocalDb(state.storage),
      {
        source: 'schedule',
        sourceId: 'cli-execution',
        outcome: 'succeeded',
        summary: 'Completed.',
        artifactIds: [],
      },
      Date.now(),
    )
  })
  const post = (action: string, body: unknown, token = 'test-token') =>
    handleCli(
      new Request(`http://localhost/cli/${action}/${id}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }),
      'test-token',
      exports.default,
      exports.default,
    )
  expect((await post('notifications', {}, 'wrong-token')).status).toBe(401)
  expect(await (await post('notifications', { unreadOnly: true })).json()).toMatchObject({
    notifications: [{ seq: 1, readAt: null }],
  })
  expect(await (await post('notification-read', { seq: 1 })).json()).toEqual({ found: true })
  expect(await (await post('notification-read', { seq: 1 })).json()).toEqual({ found: true })
  expect(await (await post('notifications', { unreadOnly: true })).json()).toEqual({
    notifications: [],
  })
  expect(await (await post('notification-read', { seq: 99 })).json()).toEqual({ found: false })
  for (const body of [{ limit: 101 }, { before: 0 }, { after: 1 }])
    expect((await post('notifications', body)).status).toBe(400)
  for (const body of [{ seq: 0 }, { through: 1 }, { seq: 1, readAt: 123 }])
    expect((await post('notification-read', body)).status).toBe(400)
})

it('enables and disables optional tools through versioned configuration without losing credentials', async () => {
  const id = await newAgentId()
  const before = await exports.default.getConfig(id)
  for (const tools of [['contact_agent'], []]) {
    const response = await handleCli(
      new Request(`http://localhost/cli/tools/${id}`, {
        method: 'POST',
        headers: { authorization: 'Bearer test-token' },
        body: JSON.stringify({ requestId: `tools-${tools.length}`, tools }),
      }),
      'test-token',
      exports.default,
      exports.default,
    )
    expect(response.status).toBe(200)
    const current = await exports.default.getConfig(id)
    expect(current.settings.tools).toEqual(tools)
    expect(current.settings.credentials).toEqual(before.settings.credentials)
  }
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

it('reuses the single installation through authenticated CLI access and resolves its slug', async () => {
  const initial = await seedOnce()
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
  expect(seeded).toEqual(initial)
  const sent = await post('send/assistant', { requestId: 'by-slug', content: 'Hello' })
  expect(sent.status).toBe(200)
  expect(JSON.stringify(decodeEvents(await sent.text()))).toContain('Hello from Kodama')
  const unknown = await post('snapshot/no-such-agent')
  expect(unknown.status).toBe(400)
})
