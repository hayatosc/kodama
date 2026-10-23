/**
 * The memory database: its Drizzle handle, record types, scopes, and extraction checkpoints.
 *
 * @see docs/memory.md — D1 schema, Scopes
 *
 * @module
 */
import * as schema from '../../../drizzle/d1/schema.ts'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { extractionCheckpoints } from '../../../drizzle/d1/schema.ts'
import type { memoryRecords, Scope } from '../../../drizzle/d1/schema.ts'

/** Every table of the D1 schema, for Drizzle's relational queries. */
export { schema }

/** Drizzle handle of the memory database. */
export type MemoryDb = DrizzleD1Database<typeof schema>
/** A memory record row. */
export type MemoryRecord = typeof memoryRecords.$inferSelect
/** A record's kind: `fact`, `instruction`, `event`, or `task`. */
export type RecordKind = MemoryRecord['kind']
/**
 * Where a record came from: a request, the agent's judgment, extraction, consolidation, or a shared write.
 */
export type RecordOrigin = MemoryRecord['origin']

/** The memory database on a D1 binding. */
export function memoryDb(d1: D1Database): MemoryDb {
  return drizzle(d1, { schema })
}

/** The last entry of an agent that extraction has covered, or 0. */
export async function extractionCheckpoint(db: MemoryDb, agentId: string): Promise<number> {
  const row = await db
    .select({ lastEntryId: extractionCheckpoints.lastEntryId })
    .from(extractionCheckpoints)
    .where(eq(extractionCheckpoints.agentId, agentId))
    .get()
  return row?.lastEntryId ?? 0
}

/** The scope of an agent's own memory. */
export function agentScope(agentId: string): Scope {
  return `agent:${agentId}`
}

/** The scopes an agent reads: its own first, then its shared spaces in order. */
export function readableScopes(agentId: string, sharedSpaces: readonly string[]): Scope[] {
  return [agentScope(agentId), ...sharedSpaces.map((space): Scope => `shared:${space}`)]
}

const SCOPE_PATTERN = /^(?:agent|shared):[a-zA-Z0-9_-]{1,64}$/

/** Whether `value` is `agent:<id>` or `shared:<space>`. */
export function isScope(value: unknown): value is Scope {
  return typeof value === 'string' && SCOPE_PATTERN.test(value)
}
