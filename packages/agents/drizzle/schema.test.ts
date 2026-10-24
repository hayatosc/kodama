import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { expect, it } from 'vitest'
import { memoryDb } from '../src/memory/store/db.ts'
import { schema } from '../src/memory/store/db.ts'
import * as localSchema from './durable-object/schema.ts'
import * as controlSchema from './control/schema.ts'
import { controlDb } from '../src/control/db.ts'
import { openLocalDb } from '../src/storage/local.ts'

const tables = Object.values(schema).filter((value) => value instanceof SQLiteTable)
const localTables = Object.values(localSchema).filter((value) => value instanceof SQLiteTable)
const controlTables = Object.values(controlSchema).filter((value) => value instanceof SQLiteTable)

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
  // A mismatch means drizzle/d1/schema.ts changed without `pnpm db:generate`.
  expect(migrated).toEqual(declared)
})

it('the newest control migration snapshot has the tables and columns of the Drizzle schema', () => {
  const declared = Object.fromEntries(
    controlTables.map((table) => [getTableConfig(table).name, declaredColumns(table)]),
  )
  const migrated = Object.fromEntries(
    Object.entries(env.TEST_CONTROL_MIGRATED_COLUMNS).map(([name, columns]) => [
      name,
      [...columns].sort(),
    ]),
  )
  // A mismatch means drizzle/control/schema.ts changed without `nr db:generate:control`.
  expect(migrated).toEqual(declared)
})

it.each(controlTables.map((table) => [getTableConfig(table).name, table] as const))(
  'the applied control migrations let Drizzle read every column of %s',
  async (_name, table) => {
    await expect(controlDb(env.CONTROL_DB).select().from(table).limit(1)).resolves.toBeDefined()
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
  // `pnpm db:generate:local`.
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
