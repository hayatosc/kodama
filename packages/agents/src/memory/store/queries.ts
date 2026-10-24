/**
 * Read-only D1 queries used by memory workflows; no tool definitions or prompt formatting.
 *
 * @module
 */
import { and, desc, eq, inArray } from 'drizzle-orm'
import { memoryRecords, scopeRevisions } from '../../../drizzle/memory/schema.ts'
import type { Scope } from '../../../drizzle/memory/schema.ts'
import type { MemoryDb } from './db.ts'

/** Current revisions for the scopes a prompt reads. */
export async function memoryRevisions(
  db: MemoryDb,
  scopes: Scope[],
): Promise<Record<string, number>> {
  const rows = await db.select().from(scopeRevisions).where(inArray(scopeRevisions.scope, scopes))
  return Object.fromEntries(rows.map((row) => [row.scope, row.revision]))
}

/** Active facts and instructions, ordered by pin, importance, and last use. */
export function promptRecords(db: MemoryDb, scopes: Scope[]) {
  return db
    .select()
    .from(memoryRecords)
    .where(
      and(
        inArray(memoryRecords.scope, scopes),
        eq(memoryRecords.status, 'active'),
        inArray(memoryRecords.kind, ['fact', 'instruction']),
      ),
    )
    .orderBy(
      desc(memoryRecords.pinned),
      desc(memoryRecords.importance),
      // SQLite orders NULL first ascending, so never-used records come last descending.
      desc(memoryRecords.lastUsedAt),
    )
}

/** Active evidence records for a proposed shared write. */
export function activeRecordsById(db: MemoryDb, ids: readonly string[]) {
  return db
    .select()
    .from(memoryRecords)
    .where(and(inArray(memoryRecords.id, [...ids]), eq(memoryRecords.status, 'active')))
}

/** The current scope and revision of an active replacement target. */
export function activeRecordRevision(db: MemoryDb, id: string) {
  return db
    .select({ scope: memoryRecords.scope, revision: memoryRecords.revision })
    .from(memoryRecords)
    .where(and(eq(memoryRecords.id, id), eq(memoryRecords.status, 'active')))
    .get()
}
