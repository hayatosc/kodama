import { env } from 'cloudflare:workers'
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { expect, it } from 'vite-plus/test'
import { memoryDb } from '../../src/memory/store/db.ts'
import * as schema from './schema.ts'

const tables = Object.values(schema).filter((value) => value instanceof SQLiteTable)

/** Orders column names by UTF-16 code units, the same order a bare sort() gives strings. */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function declaredColumns(table: SQLiteTable): string[] {
  return getTableConfig(table)
    .columns.map((column) => column.name)
    .sort(byCodeUnit)
}

it('the newest D1 migration snapshot has the tables and columns of the Drizzle schema', () => {
  const declared = Object.fromEntries(
    tables.map((table) => [getTableConfig(table).name, declaredColumns(table)]),
  )
  const migrated = Object.fromEntries(
    Object.entries(env.TEST_MIGRATED_COLUMNS).map(([name, columns]) => [
      name,
      [...columns].sort(byCodeUnit),
    ]),
  )
  // A mismatch means drizzle/memory/schema.ts changed without `vp run db:generate:memory`.
  expect(migrated).toEqual(declared)
})

it.each(tables.map((table) => [getTableConfig(table).name, table] as const))(
  'the applied D1 migrations let Drizzle read every column of %s',
  async (_name, table) => {
    await expect(memoryDb(env.MEMORY_DB).select().from(table).limit(1)).resolves.toBeDefined()
  },
)
