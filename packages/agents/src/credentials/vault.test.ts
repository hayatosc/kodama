/** Encrypted persistence and safe outward metadata. @module */
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { credentials } from '../../drizzle/management/schema.ts'
import { managementDb } from '../management/db.ts'
import { uuidv7 } from '../lib/uuid.ts'
import { credentialInsert, credentialMetadata, readCredential } from './vault.ts'

const db = managementDb(env.MANAGEMENT_DB)
const kek = btoa('01234567890123456789012345678901')

it('stores an envelope, returns only metadata, and refuses cleared credentials', async () => {
  const credentialId = uuidv7()
  const secret = 'sk-local-test-plaintext-123456'
  const { statement } = await credentialInsert(
    db,
    {
      credentialId,
      kind: 'api_key',
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
  expect(await readCredential(db, credentialId, kek)).toBe(secret)
  await expect(readCredential(db, credentialId, '')).rejects.toThrow('credential_unavailable')
  await db
    .update(credentials)
    .set({ status: 'revoked', ciphertext: null, iv: null, wrappedDek: null, wrapIv: null })
    .where(eq(credentials.credentialId, credentialId))
  await expect(readCredential(db, credentialId, kek)).rejects.toThrow('credential_unavailable')
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
