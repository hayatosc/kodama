/**
 * Data-access repository for D1 archive segment catalog reads and writes.
 *
 * @see docs/memory.md — Archive index
 *
 * @module
 */
import type { MemoryDb } from './db.ts'
import { queries } from './queries/index.ts'

/** A catalog row describing one archived conversation segment in R2. */
export interface ArchiveSegment {
  id: string
  agentId: string
  firstEntry: number
  lastEntry: number
  entryCount: number
  r2Prefix: string
  sha256: string
  bytes: number
  firstAt: number
  lastAt: number
  createdAt: number
}

/** A registered archive segment, including its R2 location. */
export async function archivedSegment(
  db: MemoryDb,
  segmentId: string,
): Promise<ArchiveSegment | undefined> {
  const row = await queries.getArchiveSegmentById.run(db, { id: segmentId })
  return row ?? undefined
}

/** The oldest segment containing entries after the requested position. */
export async function nextArchivedSegment(
  db: MemoryDb,
  agentId: string,
  after: number,
): Promise<ArchiveSegment | undefined> {
  const row = await queries.getNextArchiveSegment.run(db, { agentId, after })
  return row ?? undefined
}

/** Newest segments first, including a segment overlapping the time bound or cursor. */
export function historySegments(
  db: MemoryDb,
  agentId: string,
  limit: number,
  before: number | undefined,
  cursor: { lastAt: number; lastEntry: number } | undefined,
): Promise<ArchiveSegment[]> {
  return queries.listHistorySegments.run(db, {
    agentId,
    limit,
    before: before ?? null,
    cursorLastAt: cursor?.lastAt ?? null,
    cursorLastEntry: cursor?.lastEntry ?? null,
  })
}

/**
 * Persist a segment once and verify it can be read before pruning advances.
 *
 * @throws {@link Error} When the catalog row cannot be read back.
 */
export async function catalogSegment(db: MemoryDb, row: ArchiveSegment): Promise<void> {
  if ((await archivedSegment(db, row.id)) !== undefined) return
  await queries.insertArchiveSegment.run(db, row)
  if ((await archivedSegment(db, row.id)) === undefined) {
    throw new Error(`Archive catalog row ${row.id} was not stored`)
  }
}
