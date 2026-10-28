/**
 * Kodama's own tables in each Durable Object's SQLite, beside Pi Durable's tables.
 *
 * @see drizzle/durable-object/schema.ts
 *
 * @module
 */
import { drizzle } from 'drizzle-orm/durable-sqlite'
import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'
import { migrate } from 'drizzle-orm/durable-sqlite/migrator'
import journal from '../../drizzle/durable-object/migrations/meta/_journal.json'
import m0000 from '../../drizzle/durable-object/migrations/0000_curly_mandroid.sql?raw'
import m0001 from '../../drizzle/durable-object/migrations/0001_omniscient_agent_brand.sql?raw'
import m0002 from '../../drizzle/durable-object/migrations/0002_lovely_carnage.sql?raw'
import * as schema from '../../drizzle/durable-object/schema.ts'

/** Drizzle handle of one object's local tables. */
export type LocalDb = DrizzleSqliteDODatabase<typeof schema>

/**
 * Generated migrations of `drizzle/durable-object/schema.ts`, keyed as Drizzle's migrator expects.
 *
 * @remarks
 * Add each new migration file here. A migration that the journal lists but this map lacks makes
 * {@link openLocalDb} throw.
 */
export const localMigrations = { journal, migrations: { m0000, m0001, m0002 } }

/** Open the object's local tables, migrated to the current schema. */
export async function openLocalDb(storage: DurableObjectStorage): Promise<LocalDb> {
  const db = drizzle(storage, { schema })
  await migrate(db, localMigrations)
  return db
}
