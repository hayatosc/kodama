/**
 * Vitest configuration: tests run in workerd with the migrations and their snapshots as bindings.
 *
 * @module
 */
import { readdirSync, readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import reylo from 'reylo/vite'
import { defineConfig } from 'vite-plus'
import { nodeTestFiles } from './vitest.node.config.ts'

const migrations = await readD1Migrations(`${import.meta.dirname}/sql/memory/migrations`)
const managementMigrations = await readD1Migrations(
  `${import.meta.dirname}/sql/management/migrations`,
)

/** Columns per table produced by executing all SQL migrations in `folder` on SQLite. */
function migratedColumns(folder: string): Record<string, string[]> {
  const dir = join(import.meta.dirname, folder)
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  const db = new DatabaseSync(':memory:')
  try {
    for (const file of files) {
      db.exec(readFileSync(join(dir, file), 'utf8'))
    }
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
    const columnsByTable: Record<string, string[]> = {}
    for (const row of tables) {
      const table = row.name
      if (typeof table !== 'string') continue
      const pragma = db.prepare(`PRAGMA table_info("${table.replaceAll('"', '""')}")`).all()
      columnsByTable[table] = pragma.flatMap((col) =>
        typeof col.name === 'string' ? [col.name] : [],
      )
    }
    return columnsByTable
  } finally {
    db.close()
  }
}

const REYLO_SUFFIX = '?reylo'

/**
 * `@cloudflare/vitest-plugin` externalizes `.sql` imports via Wrangler's default `Text` module rule
 * unless the resolved ID has a query string. Appending `?reylo` lets Vitest serve Reylo's
 * transformed JS module while keeping `?raw` migration imports untouched.
 */
function reyloWorkerdPlugin(): ReturnType<typeof reylo> {
  const base = reylo()
  return {
    ...base,
    resolveId: {
      order: 'pre',
      handler(source, importer) {
        const resolved = base.resolveId.handler(source, importer)
        return resolved === null ? null : `${resolved}${REYLO_SUFFIX}`
      },
    },
    load(id) {
      if (!id.endsWith(REYLO_SUFFIX)) return Promise.resolve(null)
      return base.load.call(this, id.slice(0, -REYLO_SUFFIX.length))
    },
    configureVitest(context) {
      const key = ({ id }: { id: string }): false | undefined =>
        id.endsWith(REYLO_SUFFIX) ? false : undefined
      if (context.defineCacheKeyGenerator) context.defineCacheKeyGenerator(key)
      else context.experimental_defineCacheKeyGenerator?.(key)
    },
  }
}

export default defineConfig({
  test: {
    name: 'workerd',
    // Real npm compilation is opt-in so the normal suite remains offline.
    provide: { codeNpmSmoke: process.env.KODAMA_CODE_NPM_SMOKE === '1' },
    include: ['src/**/*.test.ts', 'cli/**/*.test.ts'],
    exclude: nodeTestFiles,
    setupFiles: ['vitest.setup.ts'],
    // Files share one runtime and module graph; vitest.setup.ts empties storage before each file.
    isolate: false,
    // Each workerd worker keeps a full Miniflare runtime and module graph. Using every core can
    // exhaust memory and take the host down, so bound workers to at most 4 and host parallelism.
    maxWorkers: Math.max(1, Math.min(4, availableParallelism())),
    // Vitest's host filesystem cache is not visible inside workerd's virtual filesystem.
    fsModuleCache: false,
    testTimeout: 15_000,
    // Real alarms can consume their marker before asynchronous pruning finishes. Allow workerd
    // integration polls the same bounded progress window used by the explicit RPC polls.
    expect: { poll: { timeout: 10_000 } },
  },
  plugins: [
    reyloWorkerdPlugin(),
    cloudflareTest({
      experimental: { newConfig: true },
      miniflare: {
        bindings: {
          CREDENTIAL_KEK_V1: 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=',
          TEST_MIGRATIONS: migrations,
          TEST_MIGRATED_COLUMNS: migratedColumns('sql/memory/migrations'),
          TEST_MANAGEMENT_MIGRATIONS: managementMigrations,
          TEST_MANAGEMENT_MIGRATED_COLUMNS: migratedColumns('sql/management/migrations'),
          TEST_LOCAL_MIGRATED_COLUMNS: migratedColumns('sql/durable-object/migrations'),
        },
        // The test runner renames the Worker; bind its local class rather than the production name.
        durableObjects: {
          AGENTS: { className: 'Agent', useSQLite: true },
        },
      },
    }),
  ],
})
