/** Envelope integrity, identity binding, and fail-closed key handling. @module */
import { expect, it } from 'vite-plus/test'
import { decryptCredential, encryptCredential } from './encryption.ts'
import type { CredentialIdentity } from './encryption.ts'

const identity: CredentialIdentity = {
  credentialId: '01900000-0000-7000-8000-000000000001',
  kind: 'api_key',
  provider: 'openai',
  revision: 1,
}
const kek = btoa('01234567890123456789012345678901')
const nextKek = btoa('12345678901234567890123456789012')
const secret = 'sk-test-plaintext-must-not-be-stored'

it('preserves a leading BOM in credential plaintext', async () => {
  const plaintext = '\uFEFFabcdefgh'
  const envelope = await encryptCredential(identity, plaintext, kek)
  expect(await decryptCredential(identity, envelope, kek)).toBe(plaintext)
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
