/** Explicit resolution, live revocation, and lease-protected modifications. @module */
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { expect, it, vi } from 'vitest'
import { auditLog, credentials, credentialGrants } from '../../drizzle/management/schema.ts'
import { managementDb } from '../management/db.ts'
import type { AgentSettings } from '../protocol.ts'
import { defaultAgentSettings } from '../configuration/index.ts'
import { credentialCall } from '../helper/credentials.ts'
import { newAgentId } from '../helper/management.ts'
import { uuidv7 } from '../lib/uuid.ts'
import { credentialInsert } from './vault.ts'
import { revokeCredential } from './management.ts'
import { createCredentialStore, CREDENTIAL_CACHE_TTL } from './store.ts'
import { credentialFingerprint } from './encryption.ts'

const db = managementDb(env.MANAGEMENT_DB)
const kek = () => env.CREDENTIAL_KEK_V1

async function fixture(kind: 'api_key' | 'oauth_subscription' = 'api_key') {
  const agentId = await newAgentId()
  const { principal } = await credentialCall()
  const primary = uuidv7()
  const alternative = uuidv7()
  for (const [credentialId, secret] of [
    [
      primary,
      kind === 'api_key'
        ? 'sk-primary-test-key'
        : JSON.stringify({
            type: 'oauth',
            access: 'access-token',
            refresh: 'refresh-token',
            expires: 2000,
          }),
    ],
    [alternative, 'sk-alternative-test-key'],
  ] as const) {
    const { statement } = await credentialInsert(
      db,
      {
        credentialId,
        kind: credentialId === primary ? kind : 'api_key',
        provider: 'openai',
        ownerId: principal.principalId,
        revision: 1,
      },
      secret,
      kek(),
      Date.now(),
    )
    await db.batch([statement, db.insert(credentialGrants).values({ agentId, credentialId })])
  }
  const settings: AgentSettings = {
    ...defaultAgentSettings(env),
    credentials: { primary: { openai: primary } },
  }
  let now = 1000
  const open = () =>
    createCredentialStore(
      db,
      async () => agentId,
      async () => settings,
      kek,
      () => now,
    )
  return {
    ...open(),
    open,
    settings,
    primary,
    advance: (milliseconds = CREDENTIAL_CACHE_TTL + 1) => {
      now += milliseconds
    },
  }
}

it('rejects a warm cached credential immediately after D1 revocation without a journal', async () => {
  const { store, primary } = await fixture()
  expect(await store.read('openai')).toEqual({ type: 'api_key', key: 'sk-primary-test-key' })
  await revokeCredential(await credentialCall(), primary)
  // This standalone store receives no object invalidation push; live D1 status is authoritative.
  await expect(store.read('openai')).rejects.toThrow('credential_unavailable')
})

it('uses only explicit references and checks status even with a warm cache and no invalidation push', async () => {
  const { store, primary, settings } = await fixture()
  expect(await store.read('openai')).toEqual({ type: 'api_key', key: 'sk-primary-test-key' })
  await expect(store.read('anthropic')).rejects.toThrow('credential_unavailable')
  await db
    .update(credentials)
    .set({ status: 'needs_reauth' })
    .where(eq(credentials.credentialId, primary))
  await expect(store.read('openai')).rejects.toThrow('credential_unavailable')
  await db
    .update(credentials)
    .set({ status: 'active' })
    .where(eq(credentials.credentialId, primary))
  await db.delete(credentialGrants).where(eq(credentialGrants.credentialId, primary))
  await expect(store.read('openai')).rejects.toThrow('credential_unavailable')
  expect(await store.list()).toEqual([])
  await db
    .update(credentials)
    .set({ status: 'revoked', ciphertext: null, iv: null, wrappedDek: null, wrapIv: null })
    .where(eq(credentials.credentialId, primary))
  await expect(store.read('openai')).rejects.toThrow('credential_unavailable')
  if (settings.credentials) delete settings.credentials.primary.openai
  await expect(store.read('openai')).rejects.toThrow('credential_unavailable')
})

it('rejects an expired subscription even when another granted key exists', async () => {
  const { store, advance } = await fixture('oauth_subscription')
  expect(await store.read('openai')).toMatchObject({ type: 'oauth', access: 'access-token' })
  advance(1001)
  await expect(store.read('openai')).rejects.toThrow('credential expired')
})

it('expires and explicitly invalidates the decrypted cache', async () => {
  const { store, primary, advance, invalidate } = await fixture()
  await store.read('openai')
  await db
    .update(credentials)
    .set({ ciphertext: btoa('broken') })
    .where(eq(credentials.credentialId, primary))
  expect(await store.read('openai')).toEqual({ type: 'api_key', key: 'sk-primary-test-key' })
  advance()
  await expect(store.read('openai')).rejects.toThrow('credential_unavailable')
  invalidate()
  await expect(store.read('openai')).rejects.toThrow('credential_unavailable')
})

it('serializes refresh across independent stores and reads the freshly committed value', async () => {
  const { store, open } = await fixture('oauth_subscription')
  const second = open().store
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let refreshes = 0
  const first = store.modify('openai', async () => {
    refreshes += 1
    started.resolve()
    await release.promise
    return { type: 'oauth', access: 'new-access', refresh: 'new-refresh', expires: 9000 }
  })
  await started.promise
  const waiting = Promise.withResolvers<void>()
  const wait = scheduler.wait.bind(scheduler)
  const waitSpy = vi.spyOn(scheduler, 'wait').mockImplementation((delay, options) => {
    waiting.resolve()
    return wait(delay, options)
  })
  const next = second.modify('openai', async (current) => {
    expect(current).toMatchObject({ access: 'new-access' })
    return undefined
  })
  const result = next.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  )
  try {
    expect(await Promise.race([waiting.promise.then(() => true), result.then(() => false)])).toBe(
      true,
    )
  } finally {
    waitSpy.mockRestore()
    release.resolve()
  }
  await first
  expect(await result).toMatchObject({ value: { access: 'new-access' } })
  expect(refreshes).toBe(1)
})

it('cancels a waiting modifier without releasing the current holder lease', async () => {
  const { store, open, primary } = await fixture()
  await store.modify('openai', async () => {
    const second = open().store
    await expect(
      second.modify(
        'openai',
        async () => {
          throw new Error('Cancelled callback must not run')
        },
        { signal: AbortSignal.timeout(10) },
      ),
    ).rejects.toThrow()
    const row = await db
      .select()
      .from(credentials)
      .where(eq(credentials.credentialId, primary))
      .get()
    expect(row?.leaseId).toEqual(expect.any(String))
    return undefined
  })
  const row = await db.select().from(credentials).where(eq(credentials.credentialId, primary)).get()
  expect(row?.leaseId).toBeNull()
})

it('releases the lease on failure without leaking callback errors', async () => {
  const { store, primary } = await fixture()
  await store.modify('openai', async (current) => {
    expect(current).toEqual({ type: 'api_key', key: 'sk-primary-test-key' })
    const held = await db
      .select()
      .from(credentials)
      .where(eq(credentials.credentialId, primary))
      .get()
    expect(held?.leaseId).toEqual(expect.any(String))
    expect(held?.leaseExpiresAt).toBeGreaterThan(1000)
    return { type: 'api_key', key: 'sk-modified-test-key' }
  })
  expect(await store.read('openai')).toEqual({ type: 'api_key', key: 'sk-modified-test-key' })
  expect(
    await db.select().from(credentials).where(eq(credentials.credentialId, primary)).get(),
  ).toMatchObject({ leaseId: null, leaseExpiresAt: null, revision: 2 })
  await expect(
    store.modify('openai', async () => {
      throw new Error('sk-secret-error')
    }),
  ).rejects.toThrow('credential modification failed')
  const row = await db.select().from(credentials).where(eq(credentials.credentialId, primary)).get()
  expect(row?.revision).toBe(2)
  expect(row?.leaseId).toBeNull()
  expect(row?.leaseExpiresAt).toBeNull()
  await expect(store.delete('openai')).rejects.toThrow('forbidden:')
})

it.each(['access', 'refresh'] as const)(
  'rejects a seven-character OAuth %s without committing refresh',
  async (field) => {
    const { store, primary } = await fixture('oauth_subscription')
    await expect(
      store.modify('openai', async () => ({
        type: 'oauth',
        access: '12345678',
        refresh: '87654321',
        expires: 3000,
        [field]: '1234567',
      })),
    ).rejects.toThrow('credential modification failed')
    expect(
      await db.select().from(credentials).where(eq(credentials.credentialId, primary)).get(),
    ).toMatchObject({ revision: 1, leaseId: null })
    expect(await db.select().from(auditLog).where(eq(auditLog.targetId, primary))).toEqual([])
  },
)

it('keeps modified credential metadata keyed and masks short OAuth tokens', async () => {
  const { store, primary } = await fixture('oauth_subscription')
  const next = { type: 'oauth' as const, access: '12345678', refresh: '87654321', expires: 3000 }
  await store.modify('openai', async () => next)
  const fingerprint = await credentialFingerprint(JSON.stringify(next), kek())
  const row = await db.select().from(credentials).where(eq(credentials.credentialId, primary)).get()
  expect(row).toMatchObject({ fingerprint, last4: '' })
  const audit = await db.select().from(auditLog).where(eq(auditLog.targetId, primary))
  expect(audit).toHaveLength(1)
  expect(audit[0]?.detailJson).toContain(fingerprint)
})

it('reclaims an expired lease and clears both lease fields after modification', async () => {
  const { store, primary } = await fixture()
  await db
    .update(credentials)
    .set({ leaseId: 'stopped-worker', leaseExpiresAt: 999 })
    .where(eq(credentials.credentialId, primary))
  await store.modify('openai', async () => {
    const held = await db
      .select()
      .from(credentials)
      .where(eq(credentials.credentialId, primary))
      .get()
    expect(held?.leaseId).toEqual(expect.any(String))
    expect(held?.leaseId).not.toBe('stopped-worker')
    expect(held?.leaseExpiresAt).toBeGreaterThan(1000)
    return { type: 'api_key', key: 'sk-recovered-key' }
  })
  expect(await store.read('openai')).toEqual({ type: 'api_key', key: 'sk-recovered-key' })
  expect(
    await db.select().from(credentials).where(eq(credentials.credentialId, primary)).get(),
  ).toMatchObject({ leaseId: null, leaseExpiresAt: null })
})

it('does not overwrite revocation during a modification callback', async () => {
  const { store, primary } = await fixture()
  await expect(
    store.modify('openai', async () => {
      await revokeCredential(await credentialCall(), primary)
      return { type: 'api_key', key: 'sk-must-not-be-written' }
    }),
  ).rejects.toThrow('credential modification failed')
  const row = await db.select().from(credentials).where(eq(credentials.credentialId, primary)).get()
  expect(row).toMatchObject({
    status: 'revoked',
    ciphertext: null,
    iv: null,
    wrappedDek: null,
    wrapIv: null,
    leaseId: null,
    leaseExpiresAt: null,
  })
})
