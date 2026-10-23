/**
 * Pruning limits, the runs recorded in the object's SQLite, and whether a run is due.
 *
 * @see docs/memory.md — Pruning
 *
 * @module
 */
import * as v from 'valibot'
import { ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import { and, desc, eq, gt, isNotNull, lt, max, ne } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/durable-sqlite'
import { pruneRuns } from '../../../drizzle/durable-object/schema.ts'
import type { LocalDb } from '../../storage/local.ts'
import { piEntries } from '../../storage/pi-tables.ts'

/** A pruning run and its state. */
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

/** The run not yet `deleted`, if any; there is at most one. */
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
 * Whether a run is unfinished, or the database is over the threshold and entries before the newest
 * head remain.
 *
 * @remarks
 * Reads storage only, so it is safe while the harness opens.
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

const GIB = 1024 * 1024 * 1024
const MIB = 1024 * 1024

/** How large an agent's database may grow. */
export interface PruneLimits {
  /** Prune once the database is larger than this. */
  thresholdBytes: number
  /** Reject new input above this until a run deletes rows. */
  hardBytes: number
  /** Entries per run, measured as stored record bytes. */
  runBytes: number
}

/** Prune above 1 GiB, refuse input above 8 GiB, and archive at most 16 MiB per run. */
export const DEFAULT_PRUNE_LIMITS: PruneLimits = {
  thresholdBytes: GIB,
  hardBytes: 8 * GIB,
  runBytes: 16 * MIB,
}

/** Storage key with which an operator can lower the limits of one object. */
export const PRUNE_LIMITS_KEY = 'kodama:prune-limits'
const limitsSchema = v.partial(
  v.object({
    thresholdBytes: v.pipe(v.number(), v.minValue(0)),
    hardBytes: v.pipe(v.number(), v.minValue(0)),
    runBytes: v.pipe(v.number(), v.minValue(1)),
  }),
)

/** How long after failed delete checks the `prune` alarm tries again. */
export const PRUNE_RETRY_MS = 10 * 60_000

/** The object's limits: the defaults, lowered by its stored override if it has one. */
export async function pruneLimits(storage: DurableObjectStorage): Promise<PruneLimits> {
  const stored = v.safeParse(limitsSchema, await storage.get(PRUNE_LIMITS_KEY))
  return { ...DEFAULT_PRUNE_LIMITS, ...(stored.success ? stored.output : {}) }
}
