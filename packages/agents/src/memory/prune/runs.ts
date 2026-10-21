/** Pruning runs in the object's SQLite, and whether one is due (Pruning). */
import { ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import { and, desc, eq, gt, isNotNull, lt, max, ne } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/durable-sqlite'
import { pruneRuns } from '../../../drizzle/durable-object/schema.ts'
import type { LocalDb } from '../../storage/local.ts'
import { piEntries } from '../../storage/pi-tables.ts'
import { pruneLimits } from './limits.ts'

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

export function unfinishedRun(local: LocalDb): Run | undefined {
  return local
    .select()
    .from(pruneRuns)
    .where(ne(pruneRuns.state, 'deleted'))
    .orderBy(desc(pruneRuns.id))
    .get()
}

/** The newest compaction or reset head of the root conversation, read without the harness. */
function latestHead(storage: DurableObjectStorage): number | undefined {
  const row = drizzle(storage)
    .select({ head: piEntries.head })
    .from(piEntries)
    .where(and(eq(piEntries.conversationId, ROOT_CONVERSATION_ID), isNotNull(piEntries.head)))
    .orderBy(desc(piEntries.id))
    .limit(1)
    .get()
  return row?.head ?? undefined
}

/**
 * A run is unfinished, or the database is over the threshold and entries before the newest head
 * remain. Reads storage only, so it is safe while the harness opens.
 */
export async function needsPrune(storage: DurableObjectStorage, local: LocalDb): Promise<boolean> {
  if (unfinishedRun(local) !== undefined) return true
  const limits = await pruneLimits(storage)
  if (storage.sql.databaseSize <= limits.thresholdBytes) return false
  const head = latestHead(storage)
  if (head === undefined) return false
  const candidate = drizzle(storage)
    .select({ id: piEntries.id })
    .from(piEntries)
    .where(
      and(
        eq(piEntries.conversationId, ROOT_CONVERSATION_ID),
        gt(piEntries.id, prunedThrough(local)),
        lt(piEntries.id, head),
      ),
    )
    .limit(1)
    .get()
  return candidate !== undefined
}

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
