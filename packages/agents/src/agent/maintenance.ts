/** When an agent prunes its session, and the input it refuses meanwhile (Pruning). */
import type { AlarmSchedule } from '../alarms.ts'
import { needsPrune, pruneLimits, pruneOnce, PRUNE_RETRY_MS } from '../memory/archive/prune.ts'
import type { PruneDeps, PruneOutcome } from '../memory/archive/prune.ts'
import type { LocalDb } from '../storage/local.ts'

/** Input is refused while the database is above the hard limit; retry after pruning. */
export const STORAGE_MAINTENANCE_ERROR =
  'storage_maintenance: the agent is archiving old history; retry later'

export interface MaintenanceDeps {
  storage: DurableObjectStorage
  alarms: AlarmSchedule
  local: () => Promise<LocalDb>
  pruneDeps: () => PruneDeps
}

export class StorageMaintenance {
  readonly #deps: MaintenanceDeps
  #pruning: Promise<PruneOutcome> | undefined

  constructor(deps: MaintenanceDeps) {
    this.#deps = deps
  }

  /**
   * Archive and delete old entries until the database is under the threshold, or one run with
   * `force`. A run whose delete checks fail is retried by the prune alarm. Concurrent calls share
   * the running pass.
   */
  prune(request: { force?: boolean } = {}): Promise<PruneOutcome> {
    if (this.#pruning !== undefined) return this.#pruning
    this.#pruning = this.#run(request.force === true).finally(() => {
      this.#pruning = undefined
    })
    return this.#pruning
  }

  async #run(force: boolean): Promise<PruneOutcome> {
    const deps = this.#deps.pruneDeps()
    let outcome = await pruneOnce(deps, { force })
    while (outcome === 'pruned' && !force) {
      const next = await pruneOnce(deps)
      if (next === 'nothing') break
      outcome = next
    }
    await this.#deps.alarms.set(
      'prune',
      outcome === 'deferred' ? Date.now() + PRUNE_RETRY_MS : undefined,
    )
    return outcome
  }

  /** Schedule pruning when it is due and not already scheduled; reads storage only. */
  async scheduleIfNeeded(): Promise<void> {
    if ((await this.#deps.alarms.get('prune')) !== undefined) return
    if (await needsPrune(this.#deps.storage, await this.#deps.local())) {
      await this.#deps.alarms.set('prune', Date.now())
    }
  }

  /** Above the hard limit, wake pruning and refuse the input with a retryable error. */
  async refuseWhenFull(): Promise<void> {
    const limits = await pruneLimits(this.#deps.storage)
    if (this.#deps.storage.sql.databaseSize <= limits.hardBytes) return
    await this.#deps.alarms.setNoLaterThan('prune', Date.now())
    throw new Error(STORAGE_MAINTENANCE_ERROR)
  }
}
