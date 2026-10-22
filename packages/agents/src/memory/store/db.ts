/** The memory database: its Drizzle handle, record types, scopes, and extraction checkpoints. */
import * as schema from '../../../drizzle/d1/schema.ts'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { extractionCheckpoints } from '../../../drizzle/d1/schema.ts'
import type { memoryRecords, Scope } from '../../../drizzle/d1/schema.ts'

export { schema }

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

export function agentScope(agentId: string): Scope {
  return `agent:${agentId}`
}

export function readableScopes(agentId: string, sharedSpaces: readonly string[]): Scope[] {
  return [agentScope(agentId), ...sharedSpaces.map((space): Scope => `shared:${space}`)]
}

const SCOPE_PATTERN = /^(?:agent|shared):[a-zA-Z0-9_-]{1,64}$/

/** `agent:<id>` or `shared:<space>`. */
export function isScope(value: unknown): value is Scope {
  return typeof value === 'string' && SCOPE_PATTERN.test(value)
}
