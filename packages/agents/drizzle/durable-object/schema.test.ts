/** Fresh schema parity, usage defaults and task uniqueness. @module */
import { uuidv7 } from '../../src/lib/uuid.ts'
import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { expect, it } from 'vitest'
import { openLocalDb } from '../../src/agent/local-db/local.ts'
import * as schema from './schema.ts'

it('stores fresh model defaults and nullable tool providers with unique tasks', async () => {
  await runInDurableObject(env.AGENTS.getByName(uuidv7()), async (_instance, state) => {
    const local = await openLocalDb(state.storage)
    local
      .insert(schema.usage)
      .values(
        [1, 2].map((input) => ({
          startedAt: 1,
          chargedAgentId: 'agent',
          actorKind: 'user' as const,
          provider: 'openai',
          model: 'model',
          input,
        })),
      )
      .run()
    const rows = local.select().from(schema.usage).all()
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.input)).toEqual([1, 2])
    for (const row of rows)
      expect(row).toMatchObject({
        kind: 'model',
        task: null,
        tool: null,
        keyless: false,
        searchCount: null,
        admittedAt: null,
        searchAttempts: [],
        searchSessionId: null,
        provider: 'openai',
        model: 'model',
      })
    const tool = {
      kind: 'tool' as const,
      task: 'unique-task',
      startedAt: 2,
      chargedAgentId: 'agent',
      actorKind: 'user' as const,
    }
    const inserted = local.insert(schema.usage).values(tool).returning().get()
    expect(inserted).toMatchObject({ kind: 'tool', provider: null, model: null })
    expect(() => local.insert(schema.usage).values(tool).run()).toThrow()
  })
})

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
      env.AGENTS.getByName(uuidv7()),
      async (_instance, state) => {
        const local = await openLocalDb(state.storage)
        return local.select().from(table).limit(1).all()
      },
    )
    expect(rows).toBeDefined()
  },
)
