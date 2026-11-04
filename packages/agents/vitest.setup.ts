/**
 * Starts every test file from empty storage while the workerd project shares one runtime and
 * module graph between files (`isolate: false`); see docs/testing.md — Shared workerd runtime.
 *
 * @module
 */
import { applyD1Migrations, runInDurableObject } from 'cloudflare:test'
import type { D1Migration } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { is } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { afterAll, vi } from 'vite-plus/test'
import * as managementSchema from './drizzle/management/schema.ts'
import * as memorySchema from './drizzle/memory/schema.ts'
import { MEMORY_AGENT_NAME } from './src/memory/jobs.ts'
import { forgetSeed } from './src/testing/management.ts'
import { stopAgentObject } from './src/testing/rpc.ts'

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

/** Delete every object of the archive bucket. */
async function clearArchive(): Promise<void> {
  for (let listed = await env.ARCHIVE.list(); ;) {
    if (listed.objects.length > 0) await env.ARCHIVE.delete(listed.objects.map(({ key }) => key))
    if (!listed.truncated) return
    listed = await env.ARCHIVE.list({ cursor: listed.cursor })
  }
}

/**
 * Clear the memory agent, the one object every file addresses by the same name: delete its storage
 * and end its background work, since its job drain lives in memory. Working agents need nothing:
 * tests address them by fresh UUIDs, and with D1 emptied first an alarm one of them left behind
 * finds no registry row or credential.
 */
async function clearMemoryAgent(attempts = 3): Promise<void> {
  try {
    await runInDurableObject(env.AGENTS.getByName(MEMORY_AGENT_NAME), (_, state) =>
      state.storage.deleteAll(),
    )
  } catch (error) {
    // An object still being reset rejects the call; a new stub reaches the next instance.
    const reset = error instanceof Error && 'durableObjectReset' in error
    if (!reset || attempts <= 1) throw error
    return clearMemoryAgent(attempts - 1)
  }
  await stopAgentObject(MEMORY_AGENT_NAME)
}

// `reset()` from cloudflare:test is not used: it leaves SQLite-backed object storage and D1 intact.
// `abortAllDurableObjects()` is not used either: alarms of objects created afterwards stopped
// firing after it.
await applyD1Migrations(env.MEMORY_DB, env.TEST_MIGRATIONS)
await applyD1Migrations(env.MANAGEMENT_DB, env.TEST_MANAGEMENT_MIGRATIONS)
await clearTables(env.MEMORY_DB, memorySchema)
await clearTables(env.MANAGEMENT_DB, managementSchema)
await clearArchive()
await clearMemoryAgent()
forgetSeed()

afterAll(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
