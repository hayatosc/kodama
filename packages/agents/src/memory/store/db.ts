/** The memory database: its Drizzle handle, record types, and extraction checkpoints. */
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import * as archive from '../../../drizzle/d1/schema/archive.ts'
import * as records from '../../../drizzle/d1/schema/records.ts'
import * as shared from '../../../drizzle/d1/schema/shared.ts'
import * as skills from '../../../drizzle/d1/schema/skills.ts'
import { extractionCheckpoints } from '../../../drizzle/d1/schema/records.ts'
import type { memoryRecords } from '../../../drizzle/d1/schema/records.ts'

/** Every table of the memory database, for Drizzle's relational queries. */
export const schema = { ...records, ...archive, ...skills, ...shared }

export type MemoryDb = DrizzleD1Database<typeof schema>
export type MemoryRecord = typeof memoryRecords.$inferSelect
export type RecordKind = MemoryRecord['kind']
export type RecordOrigin = MemoryRecord['origin']

export function memoryDb(d1: D1Database): MemoryDb {
  return drizzle(d1, { schema })
}

/** The extraction checkpoint of an agent: the last entry extraction has covered, or 0. */
export async function extractionCheckpoint(db: MemoryDb, agentId: string): Promise<number> {
  const row = await db
    .select({ lastEntryId: extractionCheckpoints.lastEntryId })
    .from(extractionCheckpoints)
    .where(eq(extractionCheckpoints.agentId, agentId))
    .get()
  return row?.lastEntryId ?? 0
}
