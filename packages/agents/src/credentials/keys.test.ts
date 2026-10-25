/** Stale writers cannot commit old-key envelopes after a KEK transition. @module */
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { credentials, systemSettings } from '../../drizzle/management/schema.ts'
import { credentialOwnerCall } from '../helper/credentials.ts'
import { uuidv7 } from '../lib/uuid.ts'
import { credentialInsert } from './vault.ts'
import { activeKek, guardKekVersion, KEK_VERSION_KEY, kekFor } from './keys.ts'

it('rolls back an old-key insert when maintenance wins the race', async () => {
  const call = await credentialOwnerCall()
  const selected = await activeKek(call.db, env)
  const id = uuidv7()
  const { statement } = await credentialInsert(
    call.db,
    {
      credentialId: id,
      kind: 'api_key',
      provider: 'openai',
      ownerScope: 'installation',
      ownerId: null,
      revision: 1,
    },
    'racing-test-secret',
    selected.key,
    call.now,
    selected.version,
  )
  await call.db
    .update(systemSettings)
    .set({ valueJson: '2' })
    .where(eq(systemSettings.key, KEK_VERSION_KEY))
  await expect(
    call.db.batch([statement, guardKekVersion(call.db, selected.version)]),
  ).rejects.toThrow()
  expect(
    await call.db.select().from(credentials).where(eq(credentials.credentialId, id)),
  ).toHaveLength(0)
})

it('fails closed on a missing or invalid key version', () => {
  expect(() => kekFor(env, 2)).toThrow('credential_unavailable')
  expect(() => kekFor(env, 3)).toThrow('credential_unavailable')
  expect(() => kekFor({ CREDENTIAL_KEK_V1: 'invalid' }, 1)).toThrow('credential_unavailable')
})
