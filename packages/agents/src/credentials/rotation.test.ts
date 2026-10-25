/** Rotation replaces every desired reference atomically and retries without new versions. @module */
import { env, exports } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { agents, agentCredentialRefs, credentials } from '../../drizzle/management/schema.ts'
import { credentialCall } from '../helper/credentials.ts'
import { putCredential } from './management.ts'
import { assignCredential } from './assignments.ts'
import { rotateCredential } from './rotation.ts'

it('moves all agents to a new key while preserving the old row for in-flight calls', async () => {
  await exports.default.seed()
  const call = await credentialCall()
  const old = await putCredential(call, env, {
    requestId: 'old',
    provider: 'openai',
    secret: 'old-test-secret',
  })
  const assigned = await assignCredential(call, old.credentialId, 'all')
  const request = { requestId: 'rotate', secret: 'new-test-secret' }
  const result = await rotateCredential(call, env, old.credentialId, request)
  expect(result.complete).toBe(true)
  expect(result.credentialId).not.toBe(old.credentialId)
  expect(result.last4).toBe('cret')
  expect(
    (
      await call.db
        .select()
        .from(credentials)
        .where(eq(credentials.credentialId, old.credentialId))
        .get()
    )?.status,
  ).toBe('retiring')
  expect(
    await call.db
      .select()
      .from(agentCredentialRefs)
      .where(eq(agentCredentialRefs.credentialId, old.credentialId)),
  ).toHaveLength(0)
  expect(
    await call.db
      .select()
      .from(agentCredentialRefs)
      .where(eq(agentCredentialRefs.credentialId, result.credentialId)),
  ).toHaveLength(assigned.agents.length)
  const versions = await call.db.select().from(agents)
  expect(await rotateCredential(call, env, old.credentialId, request)).toEqual(result)
  expect(await call.db.select().from(agents)).toEqual(versions)
  await expect(
    rotateCredential(call, env, old.credentialId, { ...request, secret: 'different-secret' }),
  ).rejects.toThrow('credential_conflict')
})
