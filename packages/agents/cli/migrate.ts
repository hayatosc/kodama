/**
 * Apply Drizzle migrations to the same local D1 storage used by the Vite dev Worker.
 * No Cloudflare account, remote database ID, or network database access is involved.
 *
 * @module
 */
import { fileURLToPath, URL } from 'node:url'
import { drizzle } from 'drizzle-orm/d1'
import { migrate } from 'drizzle-orm/d1/migrator'
import { Miniflare } from 'miniflare'

const root = fileURLToPath(new URL('../', import.meta.url))

/** Open local D1 with Vite's persistence root and binding-name fallback IDs. */
export function localDatabases(persistencePath = `${root}.wrangler/state/v3`): Miniflare {
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

/** Apply both databases' pending migrations; repeated runs preserve existing data. */
export async function migrateLocal(persistencePath?: string): Promise<void> {
  const runtime = localDatabases(persistencePath)
  try {
    for (const [binding, folder] of [
      ['MEMORY_DB', 'memory'],
      ['MANAGEMENT_DB', 'management'],
    ] as const) {
      const db = drizzle(await runtime.getD1Database(binding))
      await migrate(db, { migrationsFolder: `${root}drizzle/${folder}/migrations` })
    }
  } finally {
    await runtime.dispose()
  }
}

if (import.meta.main) await migrateLocal()
