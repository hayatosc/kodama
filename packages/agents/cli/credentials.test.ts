/** Local credential commands use only the authenticated write-only adapter. @module */
import { exports } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import { useMockModel } from '../src/helper/rpc.ts'
import { uuidv7 } from '../src/lib/uuid.ts'
import { handleCli } from './handler.ts'

useMockModel()

function post(path: string, body?: unknown, token = 'test-token') {
  return handleCli(
    new Request(`http://localhost/cli/${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    'test-token',
    exports.default,
    exports.default,
  )
}

it('bootstraps OAuth-only from login registration through explicit seed and send', async () => {
  const identity = await post('credentials/installation')
  expect(identity.status).toBe(200)
  expect(await (await post('list')).json()).toEqual([])
  const added = await post('credentials/add', {
    requestId: uuidv7(),
    provider: 'openai',
    kind: 'oauth_subscription',
    secret: JSON.stringify({
      type: 'oauth',
      access: 'oauth-only-access',
      refresh: 'oauth-only-refresh',
      expires: Date.now() + 3600000,
      clientId: 'issued-client',
      scopes: ['openid', 'chatgpt.tokens.use.direct'],
    }),
  })
  expect(added.status).toBe(200)
  const credential: { credentialId: string } = await added.json()
  const seeded = await post('seed', { credentialIds: [credential.credentialId] })
  expect(seeded.status).toBe(200)
  const installation: { installId: string } = await identity.json()
  expect(await seeded.json()).toMatchObject(installation)
  const requestId = uuidv7()
  const sent = await post('send/assistant', { requestId, content: 'Hello from OAuth bootstrap' })
  expect(sent.status).toBe(200)
  const events = await sent.text()
  expect(events).toContain('Hello from Kodama')
  expect(events).not.toContain('oauth-only-access')
})

it('creates and lists agents, registers metadata only, assigns, unassigns and revokes', async () => {
  const initial = await post('credentials/add', {
    requestId: uuidv7(),
    provider: 'openai',
    secret: 'initial-cli-key',
  })
  const credential: { credentialId: string } = await initial.json()
  expect((await post('seed', { credentialIds: [credential.credentialId] })).status).toBe(200)
  const slug = `cli-${uuidv7()}`
  const created = await post('create', {
    requestId: uuidv7(),
    slug,
    displayName: 'CLI second agent',
    credentialIds: [credential.credentialId],
  })
  expect(created.status).toBe(200)
  expect(await created.json()).toMatchObject({
    slug,
    displayName: 'CLI second agent',
    desiredVersion: 1,
  })
  expect(await (await post('list')).json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        slug,
        status: 'active',
        agentId: expect.any(String),
        appliedVersion: expect.any(Number),
      }),
      expect.objectContaining({ kind: 'dedicated' }),
    ]),
  )
  const secret = 'sk-cli-secret-must-not-be-returned'
  const added = await post('credentials/add', { requestId: uuidv7(), provider: 'openai', secret })
  expect(added.status).toBe(200)
  const text = await added.text()
  expect(text).not.toContain(secret)
  const metadata: { credentialId: string } = JSON.parse(text)
  expect(JSON.parse(text)).toMatchObject({
    kind: 'api_key',
    provider: 'openai',
    last4: 'rned',
    fingerprint: expect.any(String),
  })
  expect((await post(`credentials/assign/${metadata.credentialId}/${slug}`)).status).toBe(200)
  expect((await post(`credentials/unassign/${metadata.credentialId}/${slug}`)).status).toBe(200)
  expect((await post(`credentials/revoke/${metadata.credentialId}`)).status).toBe(200)
  const listed = await (await post('credentials/list')).text()
  expect(listed).not.toContain(secret)
  expect(JSON.parse(listed)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ credentialId: metadata.credentialId, status: 'revoked' }),
    ]),
  )
})

it('rejects unauthenticated registration and never echoes malformed credential input', async () => {
  const body = { secret: 'sk-private-failure-marker', provider: 'invalid' }
  expect((await post('credentials/add', body, 'wrong-token')).status).toBe(401)
  const failed = await post('credentials/add', body)
  expect(failed.status).toBe(400)
  expect(await failed.text()).not.toContain(body.secret)
})
