import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { expect, it } from 'vitest'
import { memoryDb } from '../src/memory/store/db.ts'
import { schema } from '../src/memory/store/db.ts'
import * as localSchema from './durable-object/schema.ts'
import * as managementSchema from './management/schema.ts'
import { managementDb } from '../src/management/db.ts'
import { openLocalDb } from '../src/storage/local.ts'

const tables = Object.values(schema).filter((value) => value instanceof SQLiteTable)
const localTables = Object.values(localSchema).filter((value) => value instanceof SQLiteTable)
const managementTables = Object.values(managementSchema).filter(
  (value) => value instanceof SQLiteTable,
)

function declaredColumns(table: SQLiteTable): string[] {
  return getTableConfig(table)
    .columns.map((column) => column.name)
    .sort()
}

it('the newest D1 migration snapshot has the tables and columns of the Drizzle schema', () => {
  const declared = Object.fromEntries(
    tables.map((table) => [getTableConfig(table).name, declaredColumns(table)]),
  )
  const migrated = Object.fromEntries(
    Object.entries(env.TEST_MIGRATED_COLUMNS).map(([name, columns]) => [name, [...columns].sort()]),
  )
  // A mismatch means drizzle/memory/schema.ts changed without `nr db:generate:memory`.
  expect(migrated).toEqual(declared)
})

it('the newest management migration snapshot has the tables and columns of the Drizzle schema', () => {
  const declared = Object.fromEntries(
    managementTables.map((table) => [getTableConfig(table).name, declaredColumns(table)]),
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

it.each(managementTables.map((table) => [getTableConfig(table).name, table] as const))(
  'the applied management migrations let Drizzle read every column of %s',
  async (_name, table) => {
    await expect(
      managementDb(env.MANAGEMENT_DB).select().from(table).limit(1),
    ).resolves.toBeDefined()
  },
)

it('the newest local migration snapshot has the tables and columns of the Drizzle schema', () => {
  const declared = Object.fromEntries(
    localTables.map((table) => [getTableConfig(table).name, declaredColumns(table)]),
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
  'the applied D1 migrations let Drizzle read every column of %s',
  async (_name, table) => {
    await expect(memoryDb(env.MEMORY_DB).select().from(table).limit(1)).resolves.toBeDefined()
  },
)

it.each(localTables.map((table) => [getTableConfig(table).name, table] as const))(
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
