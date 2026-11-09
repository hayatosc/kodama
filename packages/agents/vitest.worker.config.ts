/**
 * Vitest configuration: tests run in workerd with the migrations and their snapshots as bindings.
 *
 * @module
 */
import { readFileSync } from 'node:fs'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import * as v from 'valibot'
import { defineConfig } from 'vite-plus'
import { nodeTestFiles } from './vitest.node.config.ts'

const migrations = await readD1Migrations(`${import.meta.dirname}/drizzle/memory/migrations`)
const managementMigrations = await readD1Migrations(
  `${import.meta.dirname}/drizzle/management/migrations`,
)

const journalSchema = v.object({ entries: v.array(v.object({ idx: v.number() })) })
const snapshotSchema = v.object({
  tables: v.record(v.string(), v.object({ columns: v.record(v.string(), v.unknown()) })),
})

/** Columns per table in the newest drizzle-kit snapshot of a drizzle-kit output folder. */
function migratedColumns(folder: string): Record<string, string[]> {
  const meta = `${import.meta.dirname}/${folder}/meta`
  const journal = v.parse(journalSchema, JSON.parse(readFileSync(`${meta}/_journal.json`, 'utf8')))
  const last = journal.entries.at(-1)?.idx ?? 0
  const name = `${meta}/${String(last).padStart(4, '0')}_snapshot.json`
  const snapshot = v.parse(snapshotSchema, JSON.parse(readFileSync(name, 'utf8')))
  return Object.fromEntries(
    Object.entries(snapshot.tables).map(([table, { columns }]) => [table, Object.keys(columns)]),
  )
}

export default defineConfig({
  test: {
    name: 'workerd',
    // Real npm compilation is opt-in so the normal suite remains offline.
    provide: { codeNpmSmoke: process.env.KODAMA_CODE_NPM_SMOKE === '1' },
    include: ['src/**/*.test.ts', 'drizzle/**/*.test.ts', 'cli/**/*.test.ts'],
    exclude: nodeTestFiles,
    setupFiles: ['vitest.setup.ts'],
    // Files share one runtime and module graph; vitest.setup.ts empties storage before each file.
    isolate: false,
    // Each workerd worker keeps a full Miniflare runtime and module graph. Using every core can
    // exhaust memory and take the host down before the suite finishes, so leave half the cores
    // for the host and bound the workers.
    maxWorkers: 4,
    // Vitest's host filesystem cache is not visible inside workerd's virtual filesystem.
    fsModuleCache: false,
    testTimeout: 15_000,
    // Real alarms can consume their marker before asynchronous pruning finishes. Allow workerd
    // integration polls the same bounded progress window used by the explicit RPC polls.
    expect: { poll: { timeout: 10_000 } },
  },
  plugins: [
    cloudflareTest({
      experimental: { newConfig: true },
      miniflare: {
        bindings: {
          CREDENTIAL_KEK_V1: 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=',
          TEST_MIGRATIONS: migrations,
          TEST_MIGRATED_COLUMNS: migratedColumns('drizzle/memory/migrations'),
          TEST_MANAGEMENT_MIGRATIONS: managementMigrations,
          TEST_MANAGEMENT_MIGRATED_COLUMNS: migratedColumns('drizzle/management/migrations'),
          TEST_LOCAL_MIGRATED_COLUMNS: migratedColumns('drizzle/durable-object/migrations'),
        },
        // The test runner renames the Worker; bind its local class rather than the production name.
        durableObjects: {
          AGENTS: { className: 'Agent', useSQLite: true },
        },
      },
    }),
  ],
})
