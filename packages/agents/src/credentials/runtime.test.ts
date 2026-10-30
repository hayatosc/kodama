/** Credential refresh through agent admission, model auth, and Durable Object restart. @module */
import { evictDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { afterEach, expect, it, vi } from 'vitest'
import { credentials } from '../../drizzle/management/schema.ts'
import { managementDb } from '../control-plane/db.ts'
import { credentialCall } from '../testing/credentials.ts'
import { newAgentId } from '../testing/management.ts'
import { modelResponse, waitForAnswer } from '../testing/rpc.ts'
import { putCredential } from './management.ts'
import { assignCredential } from './assignments.ts'
import '@earendil-works/pi-ai/api/openai-responses'

const db = managementDb(env.MANAGEMENT_DB)
afterEach(() => vi.restoreAllMocks())

it('sends with an expired subscription after one refresh, including after eviction', async () => {
  const call = await credentialCall()
  const credential = await putCredential(call, env, {
    requestId: 'runtime-refresh',
    provider: 'openai',
    kind: 'oauth_subscription',
    secret: JSON.stringify({
      type: 'oauth',
      access: 'expired-access',
      refresh: 'original-refresh',
      expires: Date.now() - 1000,
      clientId: 'issued-client',
      scopes: ['chatgpt.tokens.use.direct'],
    }),
  })
  const agentId = await newAgentId()
  await assignCredential(call, credential.credentialId, agentId)
  let refreshes = 0
  let modelRequests = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init)
    if (request.url === 'https://auth.openai.com/api/accounts/oauth/token') {
      refreshes += 1
      return Response.json({
        access_token: 'runtime-refreshed-access',
        token_type: 'Bearer',
        refresh_token: 'runtime-rotated-refresh',
        expires_in: 3600,
      })
    }
    expect(request.url).toBe('https://api.openai.com/v1/responses')
    expect(request.headers.get('authorization')).toBe('Bearer runtime-refreshed-access')
    modelRequests += 1
    return modelResponse('Refreshed subscription works')
  })
  {
    using accepted = await exports.default.sendMessage(agentId, {
      requestId: 'expired',
      content: 'Hello',
    })
    expect(accepted.agentId).toBe(agentId)
    await waitForAnswer(agentId, 'expired')
    using result = await exports.default.snapshot(agentId)
    expect(result.snapshot.messages).toContainEqual(
      expect.objectContaining({ role: 'assistant', text: 'Refreshed subscription works' }),
    )
  }
  await evictDurableObject(env.AGENTS.getByName(agentId))
  using accepted = await exports.default.sendMessage(agentId, {
    requestId: 'after-eviction',
    content: 'Hello again',
  })
  expect(accepted.agentId).toBe(agentId)
  await waitForAnswer(agentId, 'after-eviction')
  expect(refreshes).toBe(1)
  expect(modelRequests).toBe(2)
  expect(
    await db
      .select()
      .from(credentials)
      .where(eq(credentials.credentialId, credential.credentialId))
      .get(),
  ).toMatchObject({ status: 'active', revision: 2, leaseId: null })
})

it('refuses admission with structured reauthentication facts after refresh rejection', async () => {
  const call = await credentialCall()
  const credential = await putCredential(call, env, {
    requestId: 'runtime-rejection',
    provider: 'openai',
    kind: 'oauth_subscription',
    secret: JSON.stringify({
      type: 'oauth',
      access: 'expired-access',
      refresh: 'rejected-refresh',
      expires: 0,
      clientId: 'issued-client',
      scopes: ['chatgpt.tokens.use.direct'],
    }),
  })
  const agentId = await newAgentId()
  await assignCredential(call, credential.credentialId, agentId)
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => Response.json({ error: 'invalid_grant' }, { status: 400 }))
  const failure = {
    message: 'credential_unavailable: openai: needs_reauth',
    cause: {
      code: 'credential_unavailable',
      status: 'needs_reauth',
      provider: 'openai',
      credentialId: credential.credentialId,
      agentId,
    },
  }
  await expect(
    Promise.resolve(
      exports.default.sendMessage(agentId, { requestId: 'rejected', content: 'Hello' }),
    ),
  ).rejects.toMatchObject(failure)
  await expect(
    Promise.resolve(
      exports.default.sendMessage(agentId, { requestId: 'still-rejected', content: 'Hello' }),
    ),
  ).rejects.toMatchObject(failure)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(await exports.default.submission(agentId, 'rejected')).toBeUndefined()
})
