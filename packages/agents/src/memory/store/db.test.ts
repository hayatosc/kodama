/**
 * D1 behavior the memory store relies on (docs/memory.md, Pi Durable assumptions).
 *
 * @module
 */
import { uuidv7 } from '../../lib/uuid.ts'
import { env } from 'cloudflare:workers'
import { expect, it } from 'vite-plus/test'
import { prepareQuery, runBatch } from '../../lib/reylo.ts'
import { memoryDb } from './db.ts'
import insertMemoryOp from './sql/insert-memory-op.sql'
import selectMemoryOpsByIds from '../../testing/sql/select-memory-ops-by-ids.sql'

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

it('rolls back every statement of a D1 batch when one statement fails', async () => {
  const db = memoryDb(env.MEMORY_DB)
  const [a, b] = [uuidv7(), uuidv7()]
  const op = (opId: string) =>
    prepareQuery(db, insertMemoryOp, {
      opId,
      jobId: 'batch',
      op: 'test',
      resultJson: '{}',
      appliedAt: 0,
    })

  await expect(runBatch(db, [op(a), op(b), op(a)])).rejects.toThrow()

  const stored = await selectMemoryOpsByIds.run(db, { opIdsJson: JSON.stringify([a, b]) })
  expect(stored).toEqual([])
})

it('applies every memory table and column declared in the SQL migrations', async () => {
  const db = memoryDb(env.MEMORY_DB)
  const { results: tables } = await db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations' ORDER BY name",
    )
    .all<{ name: string }>()
  const expectedTables = Object.keys(env.TEST_MIGRATED_COLUMNS).sort(byCodeUnit)
  expect(tables.map((row) => row.name).sort(byCodeUnit)).toEqual(expectedTables)

  for (const [table, columns] of Object.entries(env.TEST_MIGRATED_COLUMNS)) {
    const escapedTable = table.replaceAll('"', '""')
    const columnList = columns.map((col) => `"${col.replaceAll('"', '""')}"`).join(', ')
    await expect(
      db.prepare(`SELECT ${columnList} FROM "${escapedTable}" LIMIT 1`).all(),
    ).resolves.toBeDefined()
  }
})
