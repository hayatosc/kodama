/** Stable installation identity, initialized lazily without creating agents. @module */
import { eq } from 'drizzle-orm'
import { systemSettings } from '../../drizzle/management/schema.ts'
import { uuidv7 } from '../lib/uuid.ts'
import type { ManagementDb } from './db.ts'

/** Return the shared identity; concurrent first callers converge on the persisted value. */
export async function installationId(db: ManagementDb, now: number): Promise<string> {
  await db
    .insert(systemSettings)
    .values({ key: 'install_id', valueJson: JSON.stringify(uuidv7(now)) })
    .onConflictDoNothing()
  const row = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, 'install_id'))
    .get()
  const value: unknown = row === undefined ? undefined : JSON.parse(row.valueJson)
  if (typeof value !== 'string') throw new Error('Invalid installation identity')
  return value
}
