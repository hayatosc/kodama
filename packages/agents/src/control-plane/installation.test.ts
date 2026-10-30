/** Lazy identity is shared without provisioning agents or requiring credentials. @module */
import { env, exports } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import { agents, systemSettings } from '../../drizzle/management/schema.ts'
import { managementDb } from './db.ts'
import { installationId } from './installation.ts'
import { uuidv7 } from '../lib/uuid.ts'

it('converges on one identity under concurrent first use without seeding agents', async () => {
  const db = managementDb(env.MANAGEMENT_DB)
  const ids = await Promise.all([installationId(db, Date.now()), installationId(db, Date.now())])
  expect(ids[0]).toBe(ids[1])
  expect(await db.select().from(agents)).toEqual([])
  expect(await db.select().from(systemSettings)).toHaveLength(1)
})

it('allows credential registration before seed and initializes the same identity', async () => {
  const actor = { kind: 'service' as const, externalId: 'fresh-installation' }
  await exports.default.putCredential(actor, {
    requestId: uuidv7(),
    provider: 'openai',
    secret: 'installation-test-key',
  })
  const db = managementDb(env.MANAGEMENT_DB)
  const rows = await db.select().from(systemSettings)
  const id = await exports.default.getInstallationId(actor)
  expect(rows).toEqual([{ key: 'install_id', valueJson: JSON.stringify(id) }])
  expect(await db.select().from(agents)).toEqual([])
})
