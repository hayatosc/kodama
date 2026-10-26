/** Envelope integrity, identity binding, and fail-closed key handling. @module */
import { expect, it } from 'vitest'
import { decryptCredential, encryptCredential } from './encryption.ts'
import type { CredentialIdentity } from './encryption.ts'

const identity: CredentialIdentity = {
  credentialId: '01900000-0000-7000-8000-000000000001',
  kind: 'api_key',
  provider: 'openai',
  ownerId: null,
  revision: 1,
}
const kek = btoa('01234567890123456789012345678901')
const nextKek = btoa('12345678901234567890123456789012')
const secret = 'sk-test-plaintext-must-not-be-stored'

// Envelopes produced before owner_scope was removed, using an explicitly stored scope in AAD.
it.each([
  {
    ownerId: null,
    envelope: {
      ciphertext: 'UOtQZgNX2z6ZcpcsA+EXiTZft+Eyxa6MoXBooiMtEYrNwRW0DvLJG+GiJSsnZULLAuJQuw==',
      iv: 'q7IK3WS48t++PIW1',
      wrappedDek: '5D4uWY7VHyg+k97jhkTSOi4/Aa2OWPoSdgqdl9ekGjRWU9WIp0yCmdZqI3MoytA2',
      wrapIv: 'iiS6Y2NDOkgcZUlU',
    },
  },
  {
    ownerId: '01900000-0000-7000-8000-000000000003',
    envelope: {
      ciphertext: '3o2O+wtonBmL8JJjscdD4NgqFRZQ7kbxBDPiE7gQ+RjcOt16pGfLkDAsdYN2tLIeKoRp6A==',
      iv: '8giBXFP0ZXsVZKeC',
      wrappedDek: 'qLvhj/uCianVVl5Juu+OHhXrzz//NA7iMUmINmNNYNkE8U84YP+732B67p3iHrWx',
      wrapIv: 'wbRfdMDBm8kag1Uc',
    },
  },
])('decrypts the previous AAD format for owner $ownerId', async ({ ownerId, envelope }) => {
  expect(await decryptCredential({ ...identity, ownerId }, envelope, kek)).toBe(secret)
})

it('uses fresh authenticated envelopes for identical plaintexts', async () => {
  const first = await encryptCredential(identity, secret, kek)
  const second = await encryptCredential(identity, secret, kek)
  expect(JSON.stringify(first)).not.toContain(secret)
  expect(first.ciphertext).not.toBe(second.ciphertext)
  expect(first.wrappedDek).not.toBe(second.wrappedDek)
  expect(first.iv).not.toBe(second.iv)
  expect(first.wrapIv).not.toBe(second.wrapIv)
  expect(await decryptCredential(identity, first, kek)).toBe(secret)
})

it.each([
  { credentialId: '01900000-0000-7000-8000-000000000002' },
  { kind: 'oauth_subscription' as const },
  { provider: 'anthropic' },
  { ownerId: '01900000-0000-7000-8000-000000000003' },
  { revision: 2 },
])('authenticates the identity field %j', async (change) => {
  const envelope = await encryptCredential(identity, secret, kek)
  await expect(decryptCredential({ ...identity, ...change }, envelope, kek)).rejects.toThrow(
    'credential_unavailable: decryption failed',
  )
})

it.each(['', 'not-base64', btoa('short'), nextKek])(
  'rejects an unavailable or wrong KEK',
  async (wrong) => {
    const envelope = await encryptCredential(identity, secret, kek)
    await expect(decryptCredential(identity, envelope, wrong)).rejects.toThrow(
      'credential_unavailable',
    )
  },
)

it.each(['ciphertext', 'iv', 'wrappedDek', 'wrapIv'] as const)(
  'detects damaged %s',
  async (field) => {
    const envelope = await encryptCredential(identity, secret, kek)
    await expect(
      decryptCredential(identity, { ...envelope, [field]: btoa('damaged') }, kek),
    ).rejects.toThrow('credential_unavailable')
  },
)
