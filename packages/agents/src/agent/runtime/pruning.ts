/**
 * Session storage limits and pruning scheduling shared by working and system agents.
 * The agent chooses whether pruning archives history or deletes scratch work directly.
 *
 * @see docs/memory.md — Pruning
 *
 * @module
 */
import { alarmAt, setAlarm, setAlarmNoLaterThan } from './alarms.ts'
import { needsPrune, pruneLimits, PRUNE_RETRY_MS } from '../../memory/prune/runs.ts'
import { pruneOnce } from '../../memory/prune/prune.ts'
import type { PruneDeps, PruneOutcome } from '../../memory/prune/prune.ts'
import type { LocalDb } from '../local-db/local.ts'

/** The retryable error that refuses input while the database is above the hard limit. */
export const STORAGE_MAINTENANCE_ERROR =
  'storage_maintenance: the agent is archiving old history; retry later'

/**
 * Archive and delete old entries until the database is under the threshold, or run once with
 * `force`.
 *
 * @returns The last run's outcome. On `deferred`, the `prune` alarm retries later.
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

/**
 * Set the `prune` alarm when pruning is due and not already scheduled.
 *
 * @remarks
 * Reads storage only, so it is safe while the harness opens.
 */
export async function schedulePruneIfNeeded(
  storage: DurableObjectStorage,
  local: LocalDb,
): Promise<void> {
  if (alarmAt(storage, 'prune') !== undefined) return
  if (await needsPrune(storage, local)) await setAlarm(storage, 'prune', Date.now())
}

/**
 * Above the hard limit, wake pruning and refuse the input.
 *
 * @throws With {@link STORAGE_MAINTENANCE_ERROR} when the database is above the hard limit.
 */
export async function refuseWhenFull(storage: DurableObjectStorage): Promise<void> {
  const limits = await pruneLimits(storage)
  if (storage.sql.databaseSize <= limits.hardBytes) return
  await setAlarmNoLaterThan(storage, 'prune', Date.now())
  throw new Error(STORAGE_MAINTENANCE_ERROR)
}
