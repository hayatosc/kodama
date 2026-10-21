import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { expect, it } from 'vitest'
import * as schema from '../src/memory/schema.ts'
import * as localSchema from '../src/storage/local-schema.ts'
import { openLocalDb } from '../src/storage/local.ts'

const tables = Object.values(schema).filter((value) => value instanceof SQLiteTable)

it.each(tables.map((table) => [getTableConfig(table).name, table] as const))(
  'migrations create table %s with the columns of the Drizzle schema',
  async (name, table) => {
    const { results } = await env.MEMORY_DB.prepare(`SELECT name FROM pragma_table_info(?)`)
      .bind(name)
      .all<{ name: string }>()
    const migrated = results.map((column) => column.name).sort()
    const declared = getTableConfig(table)
      .columns.map((column) => column.name)
      .sort()
    // A mismatch means the schema changed without `pnpm db:generate`.
    expect(migrated).toEqual(declared)
  },
)

const localTables = Object.values(localSchema).filter((value) => value instanceof SQLiteTable)

it.each(localTables.map((table) => [getTableConfig(table).name, table] as const))(
  'local migrations create table %s with the columns of the Drizzle schema',
  async (name, table) => {
    const migrated = await runInDurableObject(
      env.AGENTS.getByName(crypto.randomUUID()),
      async (_instance, state) => {
        await openLocalDb(state.storage)
        return state.storage.sql
          .exec<{ name: string }>('SELECT name FROM pragma_table_info(?)', name)
          .toArray()
          .map((column) => column.name)
          .sort()
      },
    )
    const declared = getTableConfig(table)
      .columns.map((column) => column.name)
      .sort()
    // A mismatch means local-schema.ts changed without `pnpm db:generate:local`.
    expect(migrated).toEqual(declared)
  },
)
