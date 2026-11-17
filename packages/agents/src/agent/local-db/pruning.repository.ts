/**
 * SQLite queries for pruning runs and Pi rows, without harness or archive orchestration.
 *
 * @see docs/memory.md — Pruning
 * @module
 */
import { ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import { parseEnum } from '../../lib/reylo.ts'
import type { LocalDb } from './local.ts'
import { queries } from './queries/index.ts'

const PRUNE_STATES = ['prepared', 'exported', 'indexed', 'deleted'] as const

/** Permitted lifecycle state of a pruning run. */
export type PruneRunState = (typeof PRUNE_STATES)[number]

/** A persisted pruning run and its state. */
export interface Run {
  id: number
  firstEntry: number
  lastEntry: number
  head: number
  state: PruneRunState
  entryCount: number | null
  bytes: number | null
  sha256: string | null
  firstAt: number | null
  lastAt: number | null
  createdAt: number
  updatedAt: number
}

function parseRun(row: {
  id: number
  firstEntry: number
  lastEntry: number
  head: number
  state: string
  entryCount: number | null
  bytes: number | null
  sha256: string | null
  firstAt: number | null
  lastAt: number | null
  createdAt: number
  updatedAt: number
}): Run {
  return {
    ...row,
    state: parseEnum(PRUNE_STATES, row.state, 'prune run state'),
  }
}

/** The last entry pruned so far, or 0. */
export function prunedThrough(local: LocalDb): number {
  return queries.getPrunedThrough.runSync(local.sql).last ?? 0
}

/** The run not yet deleted, if any; there is at most one. */
export function unfinishedRun(local: LocalDb): Run | undefined {
  const row = queries.getUnfinishedPruneRun.runSync(local.sql)
  return row === null ? undefined : parseRun(row)
}

/** Whether an unpruned entry precedes the newest root compaction or reset head. */
export function hasPrunableEntries(storage: DurableObjectStorage, after: number): boolean {
  const head = queries.getLatestPiHead.runSync(storage.sql, {
    conversationId: ROOT_CONVERSATION_ID,
  })?.head
  if (head === undefined || head === null) return false
  return (
    queries.getPrunablePiEntry.runSync(storage.sql, {
      conversationId: ROOT_CONVERSATION_ID,
      after,
      head,
    }) !== null
  )
}

/** Record a run's next state, with what the step confirmed. */
export function setState(
  local: LocalDb,
  run: Run,
  change: Partial<Run> & { state: Run['state'] },
  now: number,
): Run {
  const merged = { ...run, ...change, updatedAt: now }
  const updated = queries.updatePruneRun.runSync(local.sql, {
    id: run.id,
    firstEntry: merged.firstEntry,
    lastEntry: merged.lastEntry,
    head: merged.head,
    state: merged.state,
    entryCount: merged.entryCount,
    bytes: merged.bytes,
    sha256: merged.sha256,
    firstAt: merged.firstAt,
    lastAt: merged.lastAt,
    updatedAt: merged.updatedAt,
  })
  if (updated === null) throw new Error(`Prune run ${run.id} missing during state transition`)
  return parseRun(updated)
}

/** Fix a prepared run's range before external archive work begins. */
export function createRun(
  local: LocalDb,
  first: number,
  last: number,
  head: number,
  now: number,
): Run {
  return parseRun(
    queries.insertPruneRun.runSync(local.sql, {
      firstEntry: first,
      lastEntry: last,
      head,
      createdAt: now,
      updatedAt: now,
    }),
  )
}

const MEASURE_PAGE = 200

/** Read a bounded range of root entries, including at least one record within the byte budget. */
export function measureRange(
  storage: DurableObjectStorage,
  after: number,
  head: number,
  runBytes: number,
): { first: number; last: number } | undefined {
  const encoder = new TextEncoder()
  let first: number | undefined
  let last = after
  let bytes = 0
  for (;;) {
    const page = queries.listPiEntriesRange.runSync(storage.sql, {
      conversationId: ROOT_CONVERSATION_ID,
      after: last,
      before: head,
      limit: MEASURE_PAGE,
    })
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
  return queries.listPiEntriesBetween.runSync(storage.sql, {
    conversationId: ROOT_CONVERSATION_ID,
    after: run.firstEntry - 1,
    before: run.lastEntry + 1,
  })
}

/** Whether Pi has exactly one conversation, as required before deleting root history. */
export function hasSingleConversation(storage: DurableObjectStorage): boolean {
  return queries.getPiConversationsCount.runSync(storage.sql).n === 1
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
  const after = run.firstEntry - 1
  const before = run.lastEntry + 1
  queries.deletePiEntriesBetween.runSync(storage.sql, {
    conversationId: ROOT_CONVERSATION_ID,
    after,
    before,
  })
  // Live MCP receipts need Pi's committed outcome even after their transcript is archived.
  queries.deletePrunedPiDocumentRevisions.runSync(storage.sql)
  queries.deletePrunedPiDocuments.runSync(storage.sql)
  queries.deletePrunedPiTasks.runSync(storage.sql)
  queries.deletePiRecordIdsEntries.runSync(storage.sql, { after, before })
  queries.deleteOrphanPiRecordIdsTasks.runSync(storage.sql)
  queries.deleteOrphanPiRecordIdsDocuments.runSync(storage.sql)
  setState(local, run, { state: 'deleted' }, now)
}
