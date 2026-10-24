/**
 * D1 behavior the memory store relies on (docs/memory.md, Pi Durable assumptions).
 *
 * @module
 */
import { env } from 'cloudflare:workers'
import { inArray } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { memoryOps } from '../../../drizzle/memory/schema.ts'
import { memoryDb } from './db.ts'

it('rolls back every statement of a D1 batch when one statement fails', async () => {
  const db = memoryDb(env.MEMORY_DB)
  const [a, b] = [crypto.randomUUID(), crypto.randomUUID()]
  const op = (opId: string) =>
    db
      .insert(memoryOps)
      .values({ opId, jobId: 'batch', op: 'test', resultJson: '{}', appliedAt: 0 })

  await expect(db.batch([op(a), op(b), op(a)])).rejects.toThrow()

  const stored = await db
    .select()
    .from(memoryOps)
    .where(inArray(memoryOps.opId, [a, b]))
  expect(stored).toEqual([])
})
