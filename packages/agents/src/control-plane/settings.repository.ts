/**
 * Data-access repository for key/value system settings in management D1.
 *
 * @module
 */
import type { ManagementDb } from './db.ts'
import { queries } from './queries/index.ts'

/** Fetch a raw JSON setting value by key, or `undefined` when not yet stored. */
export async function findSettingJson(db: ManagementDb, key: string): Promise<string | undefined> {
  const row = await queries.getSetting.run(db, { key })
  return row === null ? undefined : row.valueJson
}

/** Insert a setting only if the key does not exist yet. */
export async function insertSettingIgnore(
  db: ManagementDb,
  key: string,
  valueJson: string,
): Promise<void> {
  await queries.insertSettingIgnore.run(db, { key, valueJson })
}

/** Insert or overwrite a JSON setting by key. */
export async function upsertSetting(
  db: ManagementDb,
  key: string,
  valueJson: string,
): Promise<void> {
  await queries.insertSettingUpsert.run(db, { key, valueJson })
}
