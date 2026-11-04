/**
 * Starts every test file from empty storage while the workerd project shares one runtime and
 * module graph between files (`isolate: false`); see TESTING.md — Shared workerd runtime.
 *
 * @module
 */
import { applyD1Migrations, evictDurableObject, runInDurableObject } from 'cloudflare:test'
import type { D1Migration } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { is } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { afterAll, vi } from 'vitest'
import * as managementSchema from './drizzle/management/schema.ts'
import * as memorySchema from './drizzle/memory/schema.ts'
import { MEMORY_AGENT_NAME } from './src/memory/jobs.ts'
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

/**
 * Delete the storage and alarm of the object every file shares by name, and drop its instance: its
 * job drain lives in memory, and a drain the previous file left waiting would hold every new job.
 * Working agents need no cleanup: tests address them by fresh UUIDs, so no later file opens them.
 */
async function clearSharedObjects(attempts = 3): Promise<void> {
  const stub = env.AGENTS.getByName(MEMORY_AGENT_NAME)
  try {
    await runInDurableObject(stub, async (_, state) => {
      await state.storage.deleteAlarm()
      await state.storage.deleteAll()
    })
  } catch (error) {
    // An object still being reset rejects the call; a new stub reaches the next instance.
    const reset = error instanceof Error && 'durableObjectReset' in error
    if (!reset || attempts <= 1) throw error
    return clearSharedObjects(attempts - 1)
  }
  // Eviction waits for in-flight requests and fails while one never ends; abort the instance then.
  await evictDurableObject(stub).catch(() =>
    runInDurableObject(stub, (_, state) => state.abort('The test file ended')).catch(
      () => undefined,
    ),
  )
}

/** Delete every object of the archive bucket. */
async function clearArchive(): Promise<void> {
  for (let listed = await env.ARCHIVE.list(); ;) {
    if (listed.objects.length > 0) await env.ARCHIVE.delete(listed.objects.map(({ key }) => key))
    if (!listed.truncated) return
    listed = await env.ARCHIVE.list({ cursor: listed.cursor })
  }
}

// Empty D1 first: an alarm that a previous file's working agent left behind then finds no registry
// row or credential and makes no model call against this file's mocked fetch.
// `reset()` from cloudflare:test is not used: it leaves SQLite-backed object storage and D1
// intact. `abortAllDurableObjects()` and `evictAllDurableObjects()` are not used either: memory jobs
// stopped settling after them.
await applyD1Migrations(env.MEMORY_DB, env.TEST_MIGRATIONS)
await applyD1Migrations(env.MANAGEMENT_DB, env.TEST_MANAGEMENT_MIGRATIONS)
await clearTables(env.MEMORY_DB, memorySchema)
await clearTables(env.MANAGEMENT_DB, managementSchema)
await clearArchive()
await clearSharedObjects()
forgetSeed()

afterAll(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
