import { drizzle } from 'drizzle-orm/durable-sqlite'
import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'
import { migrate } from 'drizzle-orm/durable-sqlite/migrator'
import journal from '../../drizzle/durable-object/migrations/meta/_journal.json'
import m0000 from '../../drizzle/durable-object/migrations/0000_local_tables.sql?raw'
import * as schema from '../../drizzle/durable-object/schema.ts'

export type LocalDb = DrizzleSqliteDODatabase<typeof schema>

/**
 * Generated migrations of drizzle/durable-object/schema.ts, keyed as Drizzle's migrator expects.
 * A migration that the journal lists but this map lacks makes `openLocalDb` throw.
 */
export const localMigrations = { journal, migrations: { m0000 } }

/** Kodama's tables in this object's SQLite, migrated to the current schema. */
export async function openLocalDb(storage: DurableObjectStorage): Promise<LocalDb> {
  const db = drizzle(storage, { schema })
  await migrate(db, localMigrations)
  return db
}
