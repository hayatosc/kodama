/** Lazy identity is shared without provisioning agents or requiring credentials. @module */
import { env, exports } from 'cloudflare:workers'
import { expect, it } from 'vite-plus/test'
import { uuidv7 } from '../lib/uuid.ts'
import { listAllAgents, listAllSystemSettings } from '../testing/test-db.repository.ts'
import { managementDb } from './db.ts'
import { installationId } from './installation.service.ts'

it('converges on one identity under concurrent first use without seeding agents', async () => {
  const db = managementDb(env.MANAGEMENT_DB)
  const ids = await Promise.all([installationId(db, Date.now()), installationId(db, Date.now())])
  expect(ids[0]).toBe(ids[1])
  expect(await listAllAgents(db)).toEqual([])
  expect(await listAllSystemSettings(db)).toHaveLength(1)
})

it('allows credential registration before seed and initializes the same identity', async () => {
  await exports.default.putCredential({
    requestId: uuidv7(),
    provider: 'openai',
    secret: 'installation-test-key',
  })
  const db = managementDb(env.MANAGEMENT_DB)
  const rows = await listAllSystemSettings(db)
  const id = await exports.default.getInstallationId()
  expect(rows).toEqual([{ key: 'install_id', valueJson: JSON.stringify(id) }])
  expect(await listAllAgents(db)).toEqual([])
})
