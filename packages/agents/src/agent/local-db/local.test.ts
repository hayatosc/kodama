/** Fresh schema parity and idempotent migration tracking for Durable Object local tables. @module */
import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vite-plus/test'
import { uuidv7 } from '../../lib/uuid.ts'
import { LOCAL_MIGRATIONS_TABLE, localMigrations, openLocalDb } from './local.ts'

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

describe('local Durable Object SQLite migrations', () => {
  it('applies localMigrations idempotently and exposes every migrated table and column', async () => {
    const result = await runInDurableObject(
      env.AGENTS.getByName(uuidv7()),
      async (_instance, state) => {
        await openLocalDb(state.storage)
        await openLocalDb(state.storage)

        const applied = state.storage.sql
          .exec<{ name: string }>(`SELECT name FROM "${LOCAL_MIGRATIONS_TABLE}" ORDER BY name`)
          .toArray()
          .map((row) => row.name)

        const tableRows = state.storage.sql
          .exec<{ name: string }>(
            `SELECT name FROM sqlite_schema
             WHERE type = 'table'
               AND name LIKE 'kodama_%'
             ORDER BY name`,
          )
          .toArray()

        const actualColumns: Record<string, string[]> = {}
        for (const row of tableRows) {
          const escaped = row.name.replaceAll('"', '""')
          const pragma = state.storage.sql
            .exec<{ name: string }>(`PRAGMA table_info("${escaped}")`)
            .toArray()
          actualColumns[row.name] = pragma.map((col) => col.name).sort(byCodeUnit)
          // Also execute a column-explicit read against SQLite directly.
          const selectCols = pragma.map((col) => `"${col.name.replaceAll('"', '""')}"`).join(', ')
          state.storage.sql.exec(`SELECT ${selectCols} FROM "${escaped}" LIMIT 1`).toArray()
        }

        return { applied, actualColumns }
      },
    )

    expect(result.applied).toEqual(localMigrations.map((migration) => migration.name))
    const expected = Object.fromEntries(
      Object.entries(env.TEST_LOCAL_MIGRATED_COLUMNS).map(([name, columns]) => [
        name,
        [...columns].sort(byCodeUnit),
      ]),
    )
    expect(result.actualColumns).toEqual(expected)
  })
})
