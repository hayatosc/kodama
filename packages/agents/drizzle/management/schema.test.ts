import { env } from 'cloudflare:workers'
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { expect, it } from 'vitest'
import { managementDb } from '../../src/management/db.ts'
import * as schema from './schema.ts'

const tables = Object.values(schema).filter((value) => value instanceof SQLiteTable)

function declaredColumns(table: SQLiteTable): string[] {
  return getTableConfig(table)
    .columns.map((column) => column.name)
    .sort()
}

it('the newest management migration snapshot has the tables and columns of the Drizzle schema', () => {
  const declared = Object.fromEntries(
    tables.map((table) => [getTableConfig(table).name, declaredColumns(table)]),
  )
  const migrated = Object.fromEntries(
    Object.entries(env.TEST_MANAGEMENT_MIGRATED_COLUMNS).map(([name, columns]) => [
      name,
      [...columns].sort(),
    ]),
  )
  // A mismatch means drizzle/management/schema.ts changed without `nr db:generate:management`.
  expect(migrated).toEqual(declared)
})

it.each(tables.map((table) => [getTableConfig(table).name, table] as const))(
  'the applied management migrations let Drizzle read every column of %s',
  async (_name, table) => {
    await expect(
      managementDb(env.MANAGEMENT_DB).select().from(table).limit(1),
    ).resolves.toBeDefined()
  },
)
