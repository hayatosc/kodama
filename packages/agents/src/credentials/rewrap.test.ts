/** KEK replacement is resumable and never changes provider ciphertext or revives revocations. @module */
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { afterEach, expect, it } from 'vitest'
import { credentials, systemSettings } from '../../drizzle/management/schema.ts'
import { credentialOwnerCall } from '../helper/credentials.ts'
import { putCredential, revokeCredential } from './management.ts'
import { rewrapCredentials } from './rewrap.ts'
import { readCredential } from './vault.ts'

afterEach(async () => {
  const call = await credentialOwnerCall()
  await call.db
    .update(systemSettings)
    .set({ valueJson: '1' })
    .where(eq(systemSettings.key, 'credential_kek_version'))
})

const keys = { ...env, CREDENTIAL_KEK_V2: btoa('2'.repeat(32)) }

it('rewraps live and revoked records, keeps ciphertext stable and writes new rows with V2', async () => {
  const call = await credentialOwnerCall()
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
  await revokeCredential(call, env, revoked.credentialId)
  const before = await call.db
    .select()
    .from(credentials)
    .where(eq(credentials.credentialId, live.credentialId))
    .get()
  expect(await rewrapCredentials(call, keys)).toEqual({
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
  expect(after?.ciphertext).toBe(before?.ciphertext)
  expect(after?.iv).toBe(before?.iv)
  expect(after?.wrappedDek).not.toBe(before?.wrappedDek)
  expect(await readCredential(call.db, live.credentialId, keys.CREDENTIAL_KEK_V2)).toBe(
    'live-test-secret',
  )
  expect(
    (
      await call.db
        .select()
        .from(credentials)
        .where(eq(credentials.credentialId, revoked.credentialId))
        .get()
    )?.ciphertext,
  ).toBeNull()
  expect(await rewrapCredentials(call, keys)).toEqual({
    version: 2,
    rewrapped: 0,
    remaining: 0,
    complete: true,
  })
  const next = await putCredential(call, keys, {
    requestId: 'next',
    provider: 'openai',
    secret: 'next-test-secret',
  })
  expect(
    (
      await call.db
        .select()
        .from(credentials)
        .where(eq(credentials.credentialId, next.credentialId))
        .get()
    )?.kekVersion,
  ).toBe(2)
})

it('retains both KEKs and reports incomplete work while a row has a live modify lease', async () => {
  const call = await credentialOwnerCall()
  const row = await putCredential(call, env, {
    requestId: 'leased',
    provider: 'openai',
    secret: 'leased-test-secret',
  })
  await call.db
    .update(credentials)
    .set({ leaseId: 'other-writer', leaseExpiresAt: Date.now() + 60_000 })
    .where(eq(credentials.credentialId, row.credentialId))
  expect((await rewrapCredentials(call, keys)).complete).toBe(false)
  await call.db
    .update(credentials)
    .set({ leaseExpiresAt: 0 })
    .where(eq(credentials.credentialId, row.credentialId))
  expect((await rewrapCredentials(call, keys)).complete).toBe(true)
})
