/**
 * Kodama's own tables in each Durable Object's SQLite, beside Pi Durable's tables.
 *
 * @see sql/durable-object/migrations/0000_init.sql
 *
 * @module
 */
import m0000 from '../../../sql/durable-object/migrations/0000_init.sql?raw'
import { splitSqlStatements } from '../../lib/reylo.ts'

/** Handle of one object's local SQLite storage and synchronous transaction boundary. */
export type LocalDb = DurableObjectStorage

/** Ordered SQL migrations applied synchronously when a Durable Object opens. */
export const localMigrations = [{ name: '0000_init.sql', sql: m0000 }] as const

/** Table recording applied local SQLite migrations in each Durable Object. */
export const LOCAL_MIGRATIONS_TABLE = '_kodama_migrations'

/** Open the object's local tables, migrated synchronously to the current schema. */
export function openLocalDb(storage: DurableObjectStorage): Promise<LocalDb> {
  storage.transactionSync(() => {
    storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS "${LOCAL_MIGRATIONS_TABLE}" (
        name TEXT PRIMARY KEY NOT NULL,
        applied_at INTEGER NOT NULL
      )`,
    )
    const applied = new Set(
      storage.sql
        .exec<{ name: string }>(`SELECT name FROM "${LOCAL_MIGRATIONS_TABLE}"`)
        .toArray()
        .map((row) => row.name),
    )
    for (const migration of localMigrations) {
      if (applied.has(migration.name)) continue
      for (const statement of splitSqlStatements(migration.sql)) {
        storage.sql.exec(statement)
      }
      storage.sql.exec(
        `INSERT INTO "${LOCAL_MIGRATIONS_TABLE}" (name, applied_at) VALUES (?, ?)`,
        migration.name,
        Date.now(),
      )
    }
  })
  return Promise.resolve(storage)
}
