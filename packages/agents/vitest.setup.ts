/**
 * Starts every test file from empty storage while the workerd project shares one runtime and
 * module graph between files (`isolate: false`); see TESTING.md — Shared workerd runtime.
 *
 * @module
 */
import { abortAllDurableObjects, applyD1Migrations, reset } from 'cloudflare:test'
import type { D1Migration } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { is } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { afterAll, vi } from 'vitest'
import * as managementSchema from './drizzle/management/schema.ts'
import * as memorySchema from './drizzle/memory/schema.ts'
import { forgetSeed } from './src/testing/management.ts'

declare global {
  namespace Cloudflare {
    interface Env {
      /** Migrations read by vitest.config.ts; applied once, then skipped as already applied. */
      TEST_MIGRATIONS: D1Migration[]
      /** Columns per table in the newest drizzle-kit snapshots, read by vitest.config.ts. */
      TEST_MIGRATED_COLUMNS: Record<string, string[]>
      TEST_LOCAL_MIGRATED_COLUMNS: Record<string, string[]>
      TEST_MANAGEMENT_MIGRATIONS: D1Migration[]
      TEST_MANAGEMENT_MIGRATED_COLUMNS: Record<string, string[]>
    }
  }
}

/** Delete every row of the schema's tables, checking foreign keys only at the end. */
async function clearTables(database: D1Database, schema: Record<string, unknown>): Promise<void> {
  const db = drizzle(database)
  const deletes = Object.values(schema)
    .filter((value) => is(value, SQLiteTable))
    .map((table) => database.prepare(db.delete(table).toSQL().sql))
  await database.batch([database.prepare('PRAGMA defer_foreign_keys = on'), ...deletes])
}

// Stop the previous file's objects before their storage goes, so no alarm or background write
// from that file reaches this one. `reset()` deletes Durable Object storage but not D1.
await abortAllDurableObjects()
await reset()
await applyD1Migrations(env.MEMORY_DB, env.TEST_MIGRATIONS)
await applyD1Migrations(env.MANAGEMENT_DB, env.TEST_MANAGEMENT_MIGRATIONS)
await clearTables(env.MEMORY_DB, memorySchema)
await clearTables(env.MANAGEMENT_DB, managementSchema)
forgetSeed()

afterAll(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
