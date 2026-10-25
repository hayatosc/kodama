/** Explicit resolution, live revocation, and lease-protected modifications. @module */
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { credentials, credentialGrants } from '../../drizzle/management/schema.ts'
import { managementDb } from '../management/db.ts'
import type { AgentSettings } from '../protocol.ts'
import { defaultAgentSettings } from '../configuration/index.ts'
import { credentialCall } from '../helper/credentials.ts'
import { newAgentId } from '../helper/management.ts'
import { uuidv7 } from '../lib/uuid.ts'
import { credentialInsert } from './vault.ts'
import { createCredentialStore, CREDENTIAL_CACHE_TTL } from './store.ts'

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
        : JSON.stringify({ type: 'oauth', access: 'access', refresh: 'refresh', expires: 2000 }),
    ],
    [alternative, 'sk-alternative-test-key'],
  ] as const) {
    const { statement } = await credentialInsert(
      db,
      {
        credentialId,
        kind: credentialId === primary ? kind : 'api_key',
        provider: 'openai',
        ownerScope: 'principal',
        ownerId: principal.principalId,
        revision: 1,
      },
      secret,
      kek(),
      Date.now(),
    )
    await db.batch([
      statement,
      db.insert(credentialGrants).values({ agentId, credentialId, createdAt: Date.now() }),
    ])
  }
  const settings: AgentSettings = {
    ...defaultAgentSettings(env),
    credentials: { primary: { openai: primary } },
  }
  let now = 1000
  const handle = createCredentialStore(
    db,
    async () => agentId,
    async () => settings,
    kek,
    () => now,
  )
  return {
    ...handle,
    settings,
    primary,
    advance: (milliseconds = CREDENTIAL_CACHE_TTL + 1) => {
      now += milliseconds
    },
  }
}

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
  expect(await store.read('openai')).toMatchObject({ type: 'oauth', access: 'access' })
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

it('serializes modification and releases the lease on failure without leaking callback errors', async () => {
  const { store, primary } = await fixture()
  await store.modify('openai', async (current) => {
    expect(current).toEqual({ type: 'api_key', key: 'sk-primary-test-key' })
    await expect(store.modify('openai', async () => undefined)).rejects.toThrow('busy')
    return { type: 'api_key', key: 'sk-modified-test-key' }
  })
  expect(await store.read('openai')).toEqual({ type: 'api_key', key: 'sk-modified-test-key' })
  await expect(
    store.modify('openai', async () => {
      throw new Error('sk-secret-error')
    }),
  ).rejects.toThrow('credential modification failed')
  const row = await db.select().from(credentials).where(eq(credentials.credentialId, primary)).get()
  expect(row?.revision).toBe(2)
  expect(row?.leaseId).toBeNull()
  await expect(store.delete('openai')).rejects.toThrow('forbidden:')
})

it('does not overwrite revocation during a modification callback', async () => {
  const { store, primary } = await fixture()
  await expect(
    store.modify('openai', async () => {
      await db
        .update(credentials)
        .set({ status: 'revoked', ciphertext: null, iv: null, wrappedDek: null, wrapIv: null })
        .where(eq(credentials.credentialId, primary))
      return { type: 'api_key', key: 'sk-must-not-be-written' }
    }),
  ).rejects.toThrow('credential modification failed')
  const row = await db.select().from(credentials).where(eq(credentials.credentialId, primary)).get()
  expect(row?.status).toBe('revoked')
  expect(row?.ciphertext).toBeNull()
})
