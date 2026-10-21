/** How large an agent's database may grow before it prunes (docs/design/long-term-memory.md, Pruning). */
import * as v from 'valibot'

const GIB = 1024 * 1024 * 1024
const MIB = 1024 * 1024

export interface PruneLimits {
  /** Prune once the database is larger than this. */
  thresholdBytes: number
  /** Reject new input above this until a run deletes rows. */
  hardBytes: number
  /** Entries per run, measured as stored record bytes. */
  runBytes: number
}

export const DEFAULT_PRUNE_LIMITS: PruneLimits = {
  thresholdBytes: GIB,
  hardBytes: 8 * GIB,
  runBytes: 16 * MIB,
}

/** An operator can lower the limits of one object by storing this key. */
export const PRUNE_LIMITS_KEY = 'kodama:prune-limits'
const limitsSchema = v.partial(
  v.object({
    thresholdBytes: v.pipe(v.number(), v.minValue(0)),
    hardBytes: v.pipe(v.number(), v.minValue(0)),
    runBytes: v.pipe(v.number(), v.minValue(1)),
  }),
)

/** Retry a delete whose checks failed after this long. */
export const PRUNE_RETRY_MS = 10 * 60_000

export async function pruneLimits(storage: DurableObjectStorage): Promise<PruneLimits> {
  const stored = v.safeParse(limitsSchema, await storage.get(PRUNE_LIMITS_KEY))
  return { ...DEFAULT_PRUNE_LIMITS, ...(stored.success ? stored.output : {}) }
}
