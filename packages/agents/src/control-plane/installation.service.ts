/** Stable installation identity service, initialized lazily without creating agents. @module */
import { uuidv7 } from '../lib/uuid.ts'
import type { ManagementDb } from './db.ts'
import { findSettingJson, insertSettingIgnore } from './settings.repository.ts'

/** Return the shared identity; concurrent first callers converge on the persisted value. */
export async function installationId(db: ManagementDb, now: number): Promise<string> {
  await insertSettingIgnore(db, 'install_id', JSON.stringify(uuidv7(now)))
  const raw = await findSettingJson(db, 'install_id')
  const value: unknown = raw === undefined ? undefined : JSON.parse(raw)
  if (typeof value !== 'string') throw new Error('Invalid installation identity')
  return value
}
