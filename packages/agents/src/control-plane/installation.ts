/** Stable installation identity, initialized lazily without creating agents. @module */
import { uuidv7 } from '../lib/uuid.ts'
import type { ManagementDb } from './db.ts'
import insertSettingIgnore from './sql/insert-setting-ignore.sql'
import selectSetting from './sql/select-setting.sql'

/** Return the shared identity; concurrent first callers converge on the persisted value. */
export async function installationId(db: ManagementDb, now: number): Promise<string> {
  await insertSettingIgnore.run(db, { key: 'install_id', valueJson: JSON.stringify(uuidv7(now)) })
  const row = await selectSetting.run(db, { key: 'install_id' })
  const value: unknown = row === null ? undefined : JSON.parse(row.valueJson)
  if (typeof value !== 'string') throw new Error('Invalid installation identity')
  return value
}
