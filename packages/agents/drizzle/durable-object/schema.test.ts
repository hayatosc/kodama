import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { expect, it } from 'vitest'
import { openLocalDb } from '../../src/storage/local.ts'
import * as schema from './schema.ts'

const tables = Object.values(schema).filter((value) => value instanceof SQLiteTable)

function declaredColumns(table: SQLiteTable): string[] {
  return getTableConfig(table)
    .columns.map((column) => column.name)
    .sort()
}

it('the newest local migration snapshot has the tables and columns of the Drizzle schema', () => {
  const declared = Object.fromEntries(
    tables.map((table) => [getTableConfig(table).name, declaredColumns(table)]),
  )
  const migrated = Object.fromEntries(
    Object.entries(env.TEST_LOCAL_MIGRATED_COLUMNS).map(([name, columns]) => [
      name,
      [...columns].sort(),
    ]),
  )
  // A mismatch means drizzle/durable-object/schema.ts changed without
  // `nr db:generate:durable-object`.
  expect(migrated).toEqual(declared)
})

it.each(tables.map((table) => [getTableConfig(table).name, table] as const))(
  'the applied local migrations let Drizzle read every column of %s',
  async (_name, table) => {
    const rows = await runInDurableObject(
      env.AGENTS.getByName(crypto.randomUUID()),
      async (_instance, state) => {
        const local = await openLocalDb(state.storage)
        return local.select().from(table).limit(1).all()
      },
    )
    expect(rows).toBeDefined()
  },
)
