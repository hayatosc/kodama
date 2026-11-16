/**
 * Apply SQL migrations to the same local D1 storage used by the Vite dev Worker.
 * No Cloudflare account, remote database ID, or network database access is involved.
 *
 * @module
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Miniflare } from 'miniflare'
import { splitSqlStatements } from '../src/lib/reylo.ts'

const root = resolve(import.meta.dirname, '..')

/** Open local D1 with Vite's persistence root and binding-name fallback IDs. */
export function localDatabases(persistencePath = `${root}/.wrangler/state/v3`): Miniflare {
  return new Miniflare({
    resourcePersistencePath: persistencePath,
    workers: [
      {
        config: {
          name: 'local-migrations',
          compatibilityDate: '2026-10-01',
          manifest: {
            mainModule: 'index.js',
            modulesRoot: root,
            modules: { 'index.js': { type: 'esm', contents: 'export default {}' } },
          },
          env: {
            MEMORY_DB: { type: 'd1', id: 'MEMORY_DB' },
            MANAGEMENT_DB: { type: 'd1', id: 'MANAGEMENT_DB' },
          },
        },
      },
    ],
  })
}

async function applySqlMigrations(db: D1Database, folder: string): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS "d1_migrations" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`,
    )
    .run()
  const appliedRows = await db.prepare('SELECT name FROM "d1_migrations"').all<{ name: string }>()
  const applied = new Set(appliedRows.results.map(({ name }) => name))
  const files = readdirSync(folder)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  for (const name of files) {
    if (applied.has(name)) continue
    const statements = splitSqlStatements(readFileSync(join(folder, name), 'utf8'))
    const prepared = statements.map((stmt) => db.prepare(stmt))
    prepared.push(db.prepare('INSERT INTO "d1_migrations" (name) VALUES (?)').bind(name))
    await db.batch(prepared)
  }
}

/** Apply both databases' pending migrations; repeated runs preserve existing data. */
export async function migrateLocal(persistencePath?: string): Promise<void> {
  const runtime = localDatabases(persistencePath)
  try {
    for (const [binding, folder] of [
      ['MEMORY_DB', 'memory'],
      ['MANAGEMENT_DB', 'management'],
    ] as const) {
      const db = await runtime.getD1Database(binding)
      await applySqlMigrations(db, join(root, 'sql', folder, 'migrations'))
    }
  } finally {
    await runtime.dispose()
  }
}

if (import.meta.main) await migrateLocal()
