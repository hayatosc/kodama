/** When an agent prunes its session, and the input it refuses meanwhile (Pruning). */
import { alarmAt, setAlarm, setAlarmNoLaterThan } from './alarms.ts'
import { needsPrune, pruneLimits, PRUNE_RETRY_MS } from '../memory/prune/runs.ts'
import { pruneOnce } from '../memory/prune/prune.ts'
import type { PruneDeps, PruneOutcome } from '../memory/prune/prune.ts'
import type { LocalDb } from '../storage/local.ts'

/** Input is refused while the database is above the hard limit; retry after pruning. */
export const STORAGE_MAINTENANCE_ERROR =
  'storage_maintenance: the agent is archiving old history; retry later'

/**
 * Archive and delete old entries until the database is under the threshold, or one run with
 * `force`. A run whose delete checks fail is retried by the prune alarm.
 */
export async function pruneUntilUnder(deps: PruneDeps, force: boolean): Promise<PruneOutcome> {
  let outcome = await pruneOnce(deps, { force })
  while (outcome === 'pruned' && !force) {
    const next = await pruneOnce(deps)
    if (next === 'nothing') break
    outcome = next
  }
  const retryAt = outcome === 'deferred' ? Date.now() + PRUNE_RETRY_MS : undefined
  await setAlarm(deps.storage, 'prune', retryAt)
  return outcome
}

/** Schedule pruning when it is due and not already scheduled; reads storage only. */
export async function schedulePruneIfNeeded(
  storage: DurableObjectStorage,
  local: LocalDb,
): Promise<void> {
  if (alarmAt(storage, 'prune') !== undefined) return
  if (await needsPrune(storage, local)) await setAlarm(storage, 'prune', Date.now())
}

/** Above the hard limit, wake pruning and refuse the input with a retryable error. */
export async function refuseWhenFull(storage: DurableObjectStorage): Promise<void> {
  const limits = await pruneLimits(storage)
  if (storage.sql.databaseSize <= limits.hardBytes) return
  await setAlarmNoLaterThan(storage, 'prune', Date.now())
  throw new Error(STORAGE_MAINTENANCE_ERROR)
}
