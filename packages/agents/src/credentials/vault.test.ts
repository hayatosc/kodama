/** Encrypted persistence and safe outward metadata. @module */
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { credentials } from '../../drizzle/management/schema.ts'
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
        ownerScope: 'installation',
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

it('rejects ownerless principal credentials at the database boundary', async () => {
  const { statement } = await credentialInsert(
    db,
    {
      credentialId: uuidv7(),
      kind: 'api_key',
      provider: 'openai',
      ownerScope: 'principal',
      ownerId: null,
      revision: 1,
    },
    'sk-invalid-owner-key',
    kek,
    Date.now(),
  )
  await expect(db.batch([statement])).rejects.toThrow()
})
