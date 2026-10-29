/**
 * SQLite queries for pruning runs and Pi rows, without harness or archive orchestration.
 *
 * @see docs/memory.md — Pruning
 *
 * @module
 */
import { ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  lt,
  max,
  ne,
  notInArray,
} from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/durable-sqlite'
import { pruneRuns } from '../../../drizzle/durable-object/schema.ts'
import type { LocalDb } from './local.ts'
import {
  piConversations,
  piDocumentRevisions,
  piDocuments,
  piEntries,
  piRecordIds,
  piTasks,
} from './pi-tables.ts'

/** A persisted pruning run and its state. */
export type Run = typeof pruneRuns.$inferSelect

/** The last entry pruned so far, or 0. */
export function prunedThrough(local: LocalDb): number {
  const row = local
    .select({ last: max(pruneRuns.lastEntry) })
    .from(pruneRuns)
    .where(eq(pruneRuns.state, 'deleted'))
    .get()
  return row?.last ?? 0
}

/** The run not yet deleted, if any; there is at most one. */
export function unfinishedRun(local: LocalDb): Run | undefined {
  return local
    .select()
    .from(pruneRuns)
    .where(ne(pruneRuns.state, 'deleted'))
    .orderBy(desc(pruneRuns.id))
    .get()
}

/** Whether an unpruned entry precedes the newest root compaction or reset head. */
export function hasPrunableEntries(storage: DurableObjectStorage, after: number): boolean {
  const pi = drizzle(storage)
  const row = pi
    .select({ head: piEntries.head })
    .from(piEntries)
    .where(and(eq(piEntries.conversationId, ROOT_CONVERSATION_ID), isNotNull(piEntries.head)))
    .orderBy(desc(piEntries.id))
    .limit(1)
    .get()
  const head = row?.head
  if (head === undefined || head === null) return false
  return (
    pi
      .select({ id: piEntries.id })
      .from(piEntries)
      .where(
        and(
          eq(piEntries.conversationId, ROOT_CONVERSATION_ID),
          gt(piEntries.id, after),
          lt(piEntries.id, head),
        ),
      )
      .limit(1)
      .get() !== undefined
  )
}

/** Record a run's next state, with what the step confirmed. */
export function setState(
  local: LocalDb,
  run: Run,
  change: Partial<Run> & { state: Run['state'] },
  now: number,
): Run {
  return local
    .update(pruneRuns)
    .set({ ...change, updatedAt: now })
    .where(eq(pruneRuns.id, run.id))
    .returning()
    .get()
}

/** Fix a prepared run's range before external archive work begins. */
export function createRun(
  local: LocalDb,
  first: number,
  last: number,
  head: number,
  now: number,
): Run {
  return local
    .insert(pruneRuns)
    .values({
      firstEntry: first,
      lastEntry: last,
      head,
      state: 'prepared',
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()
}

const MEASURE_PAGE = 200

/** Read a bounded range of root entries, including at least one record within the byte budget. */
export function measureRange(
  storage: DurableObjectStorage,
  after: number,
  head: number,
  runBytes: number,
): { first: number; last: number } | undefined {
  const pi = drizzle(storage)
  const encoder = new TextEncoder()
  let first: number | undefined
  let last = after
  let bytes = 0
  for (;;) {
    const page = pi
      .select({ id: piEntries.id, record: piEntries.record })
      .from(piEntries)
      .where(
        and(
          eq(piEntries.conversationId, ROOT_CONVERSATION_ID),
          gt(piEntries.id, last),
          lt(piEntries.id, head),
        ),
      )
      .orderBy(asc(piEntries.id))
      .limit(MEASURE_PAGE)
      .all()
    for (const row of page) {
      const size = encoder.encode(row.record).byteLength
      if (first !== undefined && bytes + size > runBytes) return { first, last }
      first ??= row.id
      bytes += size
      last = row.id
    }
    if (page.length < MEASURE_PAGE) return first === undefined ? undefined : { first, last }
  }
}

/** Root entry records in a prepared run, oldest first. */
export function runEntries(storage: DurableObjectStorage, run: Run) {
  return drizzle(storage)
    .select({ id: piEntries.id, record: piEntries.record })
    .from(piEntries)
    .where(
      and(
        eq(piEntries.conversationId, ROOT_CONVERSATION_ID),
        gt(piEntries.id, run.firstEntry - 1),
        lt(piEntries.id, run.lastEntry + 1),
      ),
    )
    .orderBy(asc(piEntries.id))
    .all()
}

/** Whether Pi has exactly one conversation, as required before deleting root history. */
export function hasSingleConversation(storage: DurableObjectStorage): boolean {
  return drizzle(storage).select({ n: count() }).from(piConversations).get()?.n === 1
}

/**
 * Delete the run's entries, terminal tasks with their documents, and their ID records; mark deleted.
 *
 * @remarks Call inside one storage transaction, with the harness closed.
 */
export function deleteRows(
  storage: DurableObjectStorage,
  local: LocalDb,
  run: Run,
  now: number,
): void {
  const pi = drizzle(storage)
  pi.delete(piEntries)
    .where(
      and(
        eq(piEntries.conversationId, ROOT_CONVERSATION_ID),
        gt(piEntries.id, run.firstEntry - 1),
        lt(piEntries.id, run.lastEntry + 1),
      ),
    )
    .run()
  const terminalTasks = pi
    .select({ id: piTasks.id })
    .from(piTasks)
    .where(eq(piTasks.status, 'terminal'))
  const taskDocuments = pi
    .select({ id: piDocuments.id })
    .from(piDocuments)
    .where(and(eq(piDocuments.scopeKind, 'task'), inArray(piDocuments.ownerId, terminalTasks)))
  pi.delete(piDocumentRevisions).where(inArray(piDocumentRevisions.documentId, taskDocuments)).run()
  pi.delete(piDocuments)
    .where(and(eq(piDocuments.scopeKind, 'task'), inArray(piDocuments.ownerId, terminalTasks)))
    .run()
  pi.delete(piTasks).where(eq(piTasks.status, 'terminal')).run()
  pi.delete(piRecordIds)
    .where(
      and(
        eq(piRecordIds.recordType, 'entry'),
        gt(piRecordIds.id, run.firstEntry - 1),
        lt(piRecordIds.id, run.lastEntry + 1),
      ),
    )
    .run()
  pi.delete(piRecordIds)
    .where(
      and(
        eq(piRecordIds.recordType, 'task'),
        notInArray(piRecordIds.id, pi.select({ id: piTasks.id }).from(piTasks)),
      ),
    )
    .run()
  pi.delete(piRecordIds)
    .where(
      and(
        eq(piRecordIds.recordType, 'document'),
        notInArray(piRecordIds.id, pi.select({ id: piDocuments.id }).from(piDocuments)),
      ),
    )
    .run()
  setState(local, run, { state: 'deleted' }, now)
}
