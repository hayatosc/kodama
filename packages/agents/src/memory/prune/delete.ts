/**
 * The last step of a pruning run: deleting Pi's rows once nothing can still read them.
 *
 * @see docs/memory.md — Pruning
 *
 * @module
 */
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import type { Harness } from '@earendil-works/pi-durable'
import { and, count, eq, gt, inArray, lt, notInArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/durable-sqlite'
import type { LocalDb } from '../../storage/local.ts'
import {
  piConversations,
  piDocumentRevisions,
  piDocuments,
  piEntries,
  piRecordIds,
  piTasks,
} from '../../storage/pi-tables.ts'
import { setState } from './runs.ts'
import type { Run } from './runs.ts'

const context = BACKGROUND_CONTEXT

/**
 * Delete the run's entries, terminal tasks with their documents, and their ID records, and record
 * `deleted`.
 *
 * @remarks
 * Call it inside one storage transaction, with the harness closed.
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

/**
 * Whether nothing can still read the run's entries: no live task, background compaction included,
 * no queued input, only the root conversation, and a head at or past the run.
 */
export async function safeToDelete(
  storage: DurableObjectStorage,
  harness: Harness,
  run: Run,
): Promise<boolean> {
  const { tasks, submissions } = await harness.inspect(context)
  if (tasks.length > 0 || submissions.length > 0) return false
  const conversations = drizzle(storage).select({ n: count() }).from(piConversations).get()
  if (conversations?.n !== 1) return false
  const marker = await harness.commit((tx) => tx.latestHeadMarker(ROOT_CONVERSATION_ID), context)
  return marker !== undefined && marker.head >= run.head
}
