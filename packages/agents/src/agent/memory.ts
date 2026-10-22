/**
 * What a working agent object does for its long-term memory: refreshing the always-loaded copy,
 * handing new entries to the memory agent, and pruning its own session.
 *
 * @see docs/memory.md — Working agents, Extract, Pruning
 *
 * @module
 */
import type { Harness } from '@earendil-works/pi-durable'
import { extractionCheckpoint, memoryDb } from '../memory/store/db.ts'
import {
  refreshAlwaysLoaded,
  refreshAlwaysLoadedIfChanged,
} from '../memory/working/always-loaded.ts'
import { MEMORY_AGENT_NAME } from '../memory/jobs.ts'
import type { WorkingMemoryDeps } from '../memory/working/deps.ts'
import { latestEntryId } from '../memory/transcript.ts'
import { alarmAt, setAlarm, setAlarmNoLaterThan } from './alarms.ts'
import { needsPrune, pruneLimits, PRUNE_RETRY_MS } from '../memory/prune/runs.ts'
import { pruneOnce } from '../memory/prune/prune.ts'
import type { PruneDeps, PruneOutcome } from '../memory/prune/prune.ts'
import type { LocalDb } from '../storage/local.ts'

/** How long an agent stays idle before its new entries are extracted. */
export const EXTRACT_IDLE_DELAY_MS = 10 * 60_000

/**
 * Render the always-loaded copy again, or only when a scope revision changed.
 *
 * @remarks
 * Memory is an aid to the conversation, not a condition for it: a failure is logged and the
 * previous copy is kept.
 */
export async function refreshMemory(
  memory: WorkingMemoryDeps,
  options: { onlyIfChanged?: boolean } = {},
): Promise<void> {
  try {
    if (options.onlyIfChanged === true) await refreshAlwaysLoadedIfChanged(memory)
    else await refreshAlwaysLoaded(memory)
  } catch (error) {
    console.error('Long-term memory refresh failed', error)
  }
}

/**
 * Queue an `extract` job for the entries after the agent's extraction checkpoint, if there are any.
 */
export async function extractNewEntries(
  memory: WorkingMemoryDeps,
  harness: Harness,
): Promise<void> {
  const agentId = memory.agentId()
  const latest = await latestEntryId(harness)
  const checkpoint = await extractionCheckpoint(memoryDb(memory.env.MEMORY_DB), agentId)
  if (latest === undefined || latest <= checkpoint) return
  await memory.env.MEMORY_AGENT.getByName(MEMORY_AGENT_NAME).enqueue({
    kind: 'extract',
    sourceAgentId: agentId,
    afterEntry: checkpoint,
  })
}

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
