/**
 * D1 catalog reads and writes for archived conversation segments.
 *
 * @see docs/memory.md — Archive index
 *
 * @module
 */
import { and, asc, desc, eq, gt, lt, lte, or } from 'drizzle-orm'
import { archiveSegments } from '../../../drizzle/memory/schema.ts'
import type { MemoryDb } from './db.ts'

/** A registered archive segment, including its R2 location. */
export function archivedSegment(db: MemoryDb, segmentId: string) {
  return db.select().from(archiveSegments).where(eq(archiveSegments.id, segmentId)).get()
}

/** The oldest segment containing entries after the requested position. */
export function nextArchivedSegment(db: MemoryDb, agentId: string, after: number) {
  return db
    .select()
    .from(archiveSegments)
    .where(and(eq(archiveSegments.agentId, agentId), gt(archiveSegments.lastEntry, after)))
    .orderBy(asc(archiveSegments.firstEntry))
    .limit(1)
    .get()
}

/** Newest segments first, including a segment overlapping the time bound or cursor. */
export function historySegments(
  db: MemoryDb,
  agentId: string,
  limit: number,
  before: number | undefined,
  cursor: { lastAt: number; lastEntry: number } | undefined,
) {
  return db
    .select()
    .from(archiveSegments)
    .where(
      and(
        eq(archiveSegments.agentId, agentId),
        before === undefined ? undefined : lt(archiveSegments.firstAt, before),
        cursor === undefined
          ? undefined
          : or(
              lt(archiveSegments.lastAt, cursor.lastAt),
              and(
                eq(archiveSegments.lastAt, cursor.lastAt),
                lte(archiveSegments.lastEntry, cursor.lastEntry),
              ),
            ),
      ),
    )
    .orderBy(desc(archiveSegments.lastAt), desc(archiveSegments.lastEntry))
    .limit(limit)
}

/**
 * Persist a segment once and verify it can be read before pruning advances.
 *
 * @throws {@link Error} When the catalog row cannot be read back.
 */
export async function catalogSegment(db: MemoryDb, row: typeof archiveSegments.$inferInsert) {
  if ((await archivedSegment(db, row.id)) !== undefined) return
  await db.insert(archiveSegments).values(row)
  if ((await archivedSegment(db, row.id)) === undefined) {
    throw new Error(`Archive catalog row ${row.id} was not stored`)
  }
}
