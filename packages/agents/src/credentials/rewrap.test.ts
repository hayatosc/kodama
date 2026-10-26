/** Single-binding replacement fences writes and resumes without exposing provider plaintext. @module */
import { env } from 'cloudflare:workers'
import { eq, inArray } from 'drizzle-orm'
import { afterEach, expect, it } from 'vitest'
import { credentials, systemSettings } from '../../drizzle/management/schema.ts'
import { credentialCall } from '../helper/credentials.ts'
import { putCredential, revokeCredential } from './management.ts'
import { rewrapCredentials } from './rewrap.ts'
import { decryptCredential } from './encryption.ts'
import { KEK_VERSION_KEY, KEK_FINGERPRINT_KEY } from './keys.ts'

const next = { CREDENTIAL_KEK_V1: btoa('2'.repeat(32)) }
const request = { previousKek: env.CREDENTIAL_KEK_V1, previousVersion: 1 }

afterEach(async () => {
  const call = await credentialCall()
  await call.db
    .delete(systemSettings)
    .where(inArray(systemSettings.key, [KEK_VERSION_KEY, KEK_FINGERPRINT_KEY]))
})

it('rewraps live and revoked records with one binding and fences old Workers', async () => {
  const call = await credentialCall()
  const live = await putCredential(call, env, {
    requestId: 'live',
    provider: 'openai',
    secret: 'live-test-secret',
  })
  const revoked = await putCredential(call, env, {
    requestId: 'revoked',
    provider: 'openai',
    secret: 'revoked-test-secret',
  })
  await revokeCredential(call, revoked.credentialId)
  const before = await call.db
    .select()
    .from(credentials)
    .where(eq(credentials.credentialId, live.credentialId))
    .get()
  await expect(
    putCredential(call, next, {
      requestId: 'early',
      provider: 'openai',
      secret: 'early-test-secret',
    }),
  ).rejects.toThrow('KEK replacement is required')
  expect(await rewrapCredentials(call, next, request)).toEqual({
    version: 2,
    rewrapped: 2,
    remaining: 0,
    complete: true,
  })
  const after = await call.db
    .select()
    .from(credentials)
    .where(eq(credentials.credentialId, live.credentialId))
    .get()
  expect(after).toMatchObject({ leaseId: null, leaseExpiresAt: null })
  expect(after?.ciphertext).toBe(before?.ciphertext)
  expect(after?.iv).toBe(before?.iv)
  expect(after?.wrappedDek).not.toBe(before?.wrappedDek)
  if (!after?.ciphertext || !after.iv || !after.wrappedDek || !after.wrapIv)
    throw new Error('Missing envelope')
  expect(
    await decryptCredential(
      after,
      {
        ciphertext: after.ciphertext,
        iv: after.iv,
        wrappedDek: after.wrappedDek,
        wrapIv: after.wrapIv,
        kekVersion: after.kekVersion,
      },
      next.CREDENTIAL_KEK_V1,
    ),
  ).toBe('live-test-secret')
  expect(
    await call.db
      .select()
      .from(credentials)
      .where(eq(credentials.credentialId, revoked.credentialId))
      .get(),
  ).toMatchObject({
    status: 'revoked',
    ciphertext: null,
    iv: null,
    wrappedDek: null,
    wrapIv: null,
    leaseId: null,
    leaseExpiresAt: null,
  })
  expect(await rewrapCredentials(call, next, request)).toEqual({
    version: 2,
    rewrapped: 0,
    remaining: 0,
    complete: true,
  })
  await expect(
    putCredential(call, env, {
      requestId: 'outdated',
      provider: 'openai',
      secret: 'old-worker-secret',
    }),
  ).rejects.toThrow('KEK replacement is required')
  const created = await putCredential(call, next, {
    requestId: 'new',
    provider: 'openai',
    secret: 'next-test-secret',
  })
  expect(
    (
      await call.db
        .select()
        .from(credentials)
        .where(eq(credentials.credentialId, created.credentialId))
        .get()
    )?.kekVersion,
  ).toBe(2)
})

it('reports incomplete work until a modification lease expires', async () => {
  const call = await credentialCall()
  const row = await putCredential(call, env, {
    requestId: 'leased',
    provider: 'openai',
    secret: 'leased-test-secret',
  })
  await call.db
    .update(credentials)
    .set({ leaseId: 'other-writer', leaseExpiresAt: Date.now() + 60_000 })
    .where(eq(credentials.credentialId, row.credentialId))
  expect((await rewrapCredentials(call, next, request)).complete).toBe(false)
  await call.db
    .update(credentials)
    .set({ leaseExpiresAt: 0 })
    .where(eq(credentials.credentialId, row.credentialId))
  expect((await rewrapCredentials(call, next, request)).complete).toBe(true)
  expect(
    await call.db
      .select()
      .from(credentials)
      .where(eq(credentials.credentialId, row.credentialId))
      .get(),
  ).toMatchObject({ leaseId: null, leaseExpiresAt: null })
})
