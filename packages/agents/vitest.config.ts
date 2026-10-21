import { readFileSync } from 'node:fs'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import * as v from 'valibot'
import { defineConfig } from 'vitest/config'

const migrations = await readD1Migrations(`${import.meta.dirname}/drizzle/d1`)

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
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    fsModuleCache: false,
    testTimeout: 15_000,
  },
  plugins: [
    cloudflareTest({
      experimental: { newConfig: true },
      miniflare: {
        bindings: {
          OPENAI_API_KEY: 'test-key',
          ANTHROPIC_API_KEY: '',
          GEMINI_API_KEY: '',
          XAI_API_KEY: 'xai-test-key',
          TEST_MIGRATIONS: migrations,
          TEST_MIGRATED_COLUMNS: migratedColumns('drizzle/d1'),
          TEST_LOCAL_MIGRATED_COLUMNS: migratedColumns('drizzle/durable-object'),
        },
        // The test runner renames the Worker; bind its local class rather than the production name.
        durableObjects: {
          AGENTS: { className: 'Agent', useSQLite: true },
          MEMORY_AGENT: { className: 'MemoryAgent', useSQLite: true },
        },
      },
    }),
  ],
})
