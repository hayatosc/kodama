/** Encrypted persistence and safe outward metadata. @module */
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { credentials, principals } from '../../drizzle/management/schema.ts'
import { managementDb } from '../management/db.ts'
import { uuidv7 } from '../lib/uuid.ts'
import { sha256Hex } from '../lib/hash.ts'
import { credentialInsert, credentialMetadata, parseCredential } from './vault.ts'

const db = managementDb(env.MANAGEMENT_DB)
const kek = btoa('01234567890123456789012345678901')

it.each(['api_key', 'oauth_subscription'] as const)(
  'stores and revokes %s through the same envelope mechanism',
  async (kind) => {
    const credentialId = uuidv7()
    const secret =
      kind === 'api_key'
        ? 'sk-local-test-plaintext-123456'
        : JSON.stringify({
            type: 'oauth',
            access: 'provider-access-123456',
            refresh: 'refresh-secret',
            expires: Date.now() + 60000,
            accountId: 'account-1',
          })
    const { statement } = await credentialInsert(
      db,
      {
        credentialId,
        kind,
        provider: 'openai',
        ownerId: null,
        revision: 1,
      },
      secret,
      kek,
      Date.now(),
    )
    const [rows] = await db.batch([statement])
    const row = rows[0]
    if (!row) throw new Error('Missing inserted credential')
    expect(JSON.stringify(row)).not.toContain(secret)
    expect(row).toMatchObject({ status: 'active', leaseId: null, leaseExpiresAt: null })
    for (const value of [row.ciphertext, row.iv, row.wrappedDek, row.wrapIv]) {
      expect(value).toEqual(expect.any(String))
      expect(value?.length).toBeGreaterThan(0)
    }
    const metadata = credentialMetadata(row)
    expect(metadata.last4).toBe('3456')
    expect(metadata.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(metadata).not.toHaveProperty('ciphertext')
    expect(metadata).not.toHaveProperty('wrappedDek')
    await db
      .update(credentials)
      .set({ status: 'revoked', ciphertext: null, iv: null, wrappedDek: null, wrapIv: null })
      .where(eq(credentials.credentialId, credentialId))
    expect(
      await db.select().from(credentials).where(eq(credentials.credentialId, credentialId)).get(),
    ).toMatchObject({
      status: 'revoked',
      ciphertext: null,
      iv: null,
      wrappedDek: null,
      wrapIv: null,
    })
  },
)

it('does not expose an offline secret verifier or a suffix of a minimum-length OAuth token', async () => {
  const secret = JSON.stringify({
    type: 'oauth',
    access: 'abcdefgh',
    refresh: 'refresh1',
    expires: 123,
  })
  const fingerprints = []
  for (const key of [kek, btoa('11234567890123456789012345678901')]) {
    const { statement } = await credentialInsert(
      db,
      {
        credentialId: uuidv7(),
        kind: 'oauth_subscription',
        provider: 'openai',
        ownerId: null,
        revision: 1,
      },
      secret,
      key,
      Date.now(),
    )
    const [rows] = await db.batch([statement])
    const row = rows[0]
    if (!row) throw new Error('Missing inserted credential')
    const metadata = credentialMetadata(row)
    expect.soft(metadata.last4).toBe('')
    expect.soft(metadata.fingerprint).not.toBe(await sha256Hex(secret))
    fingerprints.push(metadata.fingerprint)
  }
  expect(fingerprints[0]).not.toBe(fingerprints[1])
})

it('preserves provider OAuth fields and rejects malformed payloads without echoing them', () => {
  expect(
    parseCredential(
      'oauth_subscription',
      JSON.stringify({
        type: 'oauth',
        access: 'access12',
        refresh: 'refresh1',
        expires: 123,
        accountId: 'account-1',
      }),
    ),
  ).toEqual({
    type: 'oauth',
    access: 'access12',
    refresh: 'refresh1',
    expires: 123,
    accountId: 'account-1',
  })
  expect(() => parseCredential('oauth_subscription', 'secret-value')).toThrow(
    'credential_unavailable: invalid credential payload',
  )
})

it.each(['access', 'refresh'] as const)(
  'enforces the OAuth %s boundary before encrypted registration',
  async (field) => {
    for (const length of [5, 7, 8]) {
      const secret = JSON.stringify({
        type: 'oauth',
        access: 'access12',
        refresh: 'refresh1',
        expires: 123,
        [field]: 'x'.repeat(length),
      })
      const insert = credentialInsert(
        db,
        {
          credentialId: uuidv7(),
          kind: 'oauth_subscription',
          provider: 'openai',
          ownerId: null,
          revision: 1,
        },
        secret,
        kek,
        Date.now(),
      )
      if (length < 8) await expect(insert).rejects.toThrow('invalid credential payload')
      else await expect(insert).resolves.toHaveProperty('statement')
    }
  },
)

it('does not expose a suffix of a minimum-length API key', async () => {
  const { statement } = await credentialInsert(
    db,
    { credentialId: uuidv7(), kind: 'api_key', provider: 'openai', ownerId: null, revision: 1 },
    '12345678',
    kek,
    Date.now(),
  )
  const [rows] = await db.batch([statement])
  expect(rows[0]?.last4).toBe('')
})

it.each([false, true])(
  'derives ownership metadata from owner_id (principal: %s)',
  async (principal) => {
    const ownerId = principal ? uuidv7() : null
    if (ownerId)
      await db.insert(principals).values({
        principalId: ownerId,
        kind: 'user',
        externalId: ownerId,
        displayName: 'Owner',
        createdAt: 1,
      })
    const { statement } = await credentialInsert(
      db,
      {
        credentialId: uuidv7(),
        kind: 'api_key',
        provider: 'openai',
        ownerId,
        revision: 1,
      },
      'sk-invalid-owner-key',
      kek,
      Date.now(),
    )
    const [rows] = await db.batch([statement])
    const row = rows[0]
    if (!row) throw new Error('Missing inserted credential')
    expect(credentialMetadata(row)).toMatchObject({
      ownerScope: principal ? 'principal' : 'installation',
      ownerId,
      lastUsedAt: null,
    })
    expect(row).not.toHaveProperty('ownerScope')
    expect(row).not.toHaveProperty('lastUsedAt')
  },
)
