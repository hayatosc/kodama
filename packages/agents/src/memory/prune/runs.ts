/**
 * Pruning limits and the policy for deciding when a run is due.
 *
 * @see docs/memory.md — Pruning
 *
 * @module
 */
import * as v from 'valibot'
import type { LocalDb } from '../../agent/local-db/local.ts'
import { hasPrunableEntries, prunedThrough, unfinishedRun } from '../../agent/local-db/pruning.ts'

/**
 * Whether a run is unfinished, or the database is over the threshold and entries before the newest
 * head remain.
 *
 * @remarks Reads storage only, so it is safe while the harness opens.
 */
export async function needsPrune(storage: DurableObjectStorage, local: LocalDb): Promise<boolean> {
  if (unfinishedRun(local) !== undefined) return true
  const limits = await pruneLimits(storage)
  if (storage.sql.databaseSize <= limits.thresholdBytes) return false
  return hasPrunableEntries(storage, prunedThrough(local))
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

/** How long after failed delete checks the prune alarm tries again. */
export const PRUNE_RETRY_MS = 10 * 60_000

/** The object's limits: the defaults, lowered by its stored override if it has one. */
export async function pruneLimits(storage: DurableObjectStorage): Promise<PruneLimits> {
  const stored = v.safeParse(limitsSchema, await storage.get(PRUNE_LIMITS_KEY))
  return { ...DEFAULT_PRUNE_LIMITS, ...(stored.success ? stored.output : {}) }
}
