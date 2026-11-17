/** Encrypted persistence and safe outward metadata. @module */
import { env } from 'cloudflare:workers'
import { expect, it } from 'vite-plus/test'
import { managementDb } from '../control-plane/db.ts'
import { sha256Hex } from '../lib/hash.ts'
import { runBatch } from '../lib/reylo.ts'
import { uuidv7 } from '../lib/uuid.ts'
import { updateClearCredentialEnvelope } from '../testing/test-db.repository.ts'
import { findCredentialById } from './vault.repository.ts'
import { credentialInsert, credentialMetadata, parseCredential } from './vault.service.ts'

const db = managementDb(env.MANAGEMENT_DB)
const kek = btoa('01234567890123456789012345678901')

async function insertAndRead(
  identity: {
    credentialId: string
    kind: 'api_key' | 'oauth_subscription'
    provider: string
    revision: number
  },
  secret: string,
  key: string,
  now: number,
) {
  const { statement } = await credentialInsert(db, identity, secret, key, now)
  await runBatch(db, [statement])
  const row = await findCredentialById(db, identity.credentialId)
  if (!row) throw new Error('Missing inserted credential')
  return row
}

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
    const row = await insertAndRead(
      { credentialId, kind, provider: 'openai', revision: 1 },
      secret,
      kek,
      Date.now(),
    )
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
    await updateClearCredentialEnvelope(db, { credentialId, status: 'revoked' })
    expect(await findCredentialById(db, credentialId)).toMatchObject({
      status: 'revoked',
      ciphertext: null,
      iv: null,
      wrappedDek: null,
      wrapIv: null,
    })
  },
)

it('does not expose an offline secret verifier or a suffix of a short OAuth token', async () => {
  const secret = JSON.stringify({
    type: 'oauth',
    access: 'abcdefgh',
    refresh: 'refresh1',
    expires: 123,
  })
  const fingerprints = []
  for (const key of [kek, btoa('11234567890123456789012345678901')]) {
    const row = await insertAndRead(
      { credentialId: uuidv7(), kind: 'oauth_subscription', provider: 'openai', revision: 1 },
      secret,
      key,
      Date.now(),
    )
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
  'requires at least eight characters in OAuth %s values',
  async (field) => {
    for (const token of ['', '   ', 'x', '1234567', '12345678']) {
      const secret = JSON.stringify({
        type: 'oauth',
        access: 'access12',
        refresh: 'refresh1',
        expires: 123,
        [field]: token,
      })
      const insert = credentialInsert(
        db,
        { credentialId: uuidv7(), kind: 'oauth_subscription', provider: 'openai', revision: 1 },
        secret,
        kek,
        Date.now(),
      )
      if (token.trim().length < 8)
        await expect(insert).rejects.toThrow('invalid credential payload')
      else await expect(insert).resolves.toHaveProperty('statement')
    }
  },
)

it('does not expose a suffix of a minimum-length API key', async () => {
  const row = await insertAndRead(
    { credentialId: uuidv7(), kind: 'api_key', provider: 'openai', revision: 1 },
    '12345678',
    kek,
    Date.now(),
  )
  expect(row.last4).toBe('')
})

it('returns installation credential metadata without user ownership', async () => {
  const row = await insertAndRead(
    {
      credentialId: uuidv7(),
      kind: 'api_key',
      provider: 'openai',
      revision: 1,
    },
    'sk-invalid-owner-key',
    kek,
    Date.now(),
  )
  expect(credentialMetadata(row)).toMatchObject({
    lastUsedAt: null,
  })
  expect(credentialMetadata(row)).not.toHaveProperty('ownerScope')
  expect(row).not.toHaveProperty('ownerId')
  expect(row.lastUsedAt).toBeNull()
})
