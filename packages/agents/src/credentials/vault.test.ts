/** Encrypted persistence and safe outward metadata. @module */
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { credentials, principals } from '../../drizzle/management/schema.ts'
import { managementDb } from '../management/db.ts'
import { uuidv7 } from '../lib/uuid.ts'
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
            access: 'access-123456',
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

it('preserves provider OAuth fields and rejects malformed payloads without echoing them', () => {
  expect(
    parseCredential(
      'oauth_subscription',
      JSON.stringify({
        type: 'oauth',
        access: 'a',
        refresh: 'r',
        expires: 123,
        accountId: 'account-1',
      }),
    ),
  ).toEqual({ type: 'oauth', access: 'a', refresh: 'r', expires: 123, accountId: 'account-1' })
  expect(() => parseCredential('oauth_subscription', 'secret-value')).toThrow(
    'credential_unavailable: invalid credential payload',
  )
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
    for (const lease of [
      { leaseId: 'lease', leaseExpiresAt: null },
      { leaseId: null, leaseExpiresAt: 123 },
    ]) {
      await expect(
        db.update(credentials).set(lease).where(eq(credentials.credentialId, row.credentialId)),
      ).rejects.toThrow()
    }
    await db
      .update(credentials)
      .set({ leaseId: 'lease', leaseExpiresAt: 123 })
      .where(eq(credentials.credentialId, row.credentialId))
    await db
      .update(credentials)
      .set({ leaseId: null, leaseExpiresAt: null })
      .where(eq(credentials.credentialId, row.credentialId))
    await expect(
      db
        .update(credentials)
        .set({ status: 'revoked' })
        .where(eq(credentials.credentialId, row.credentialId)),
    ).rejects.toThrow()
  },
)
