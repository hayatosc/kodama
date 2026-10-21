/**
 * Pruning: archive old Pi entries to R2 and delete them from the Durable Object, as a resumable
 * state machine (docs/memory.md, Pruning).
 */
import type { Harness } from '@earendil-works/pi-durable'
import type { AgentEnv } from '../../env.ts'
import type { LocalDb } from '../../storage/local.ts'
import { deleteRows, safeToDelete } from './delete.ts'
import { pruneLimits } from './limits.ts'
import { unfinishedRun } from './runs.ts'
import { catalog, exportRun, prepare } from './steps.ts'

export type PruneOutcome = 'nothing' | 'deferred' | 'pruned'

export interface PruneDeps {
  storage: DurableObjectStorage
  env: Pick<AgentEnv, 'MEMORY_DB' | 'ARCHIVE' | 'MEMORY_AGENT'>
  agentId: () => string
  local: () => Promise<LocalDb>
  harness: () => Promise<Harness>
  /**
   * In one exclusive section: run `check` against the open harness and, if it passes, close the
   * harness, run `mutate` in one storage transaction, and open it again.
   */
  exclusive: (check: (harness: Harness) => Promise<boolean>, mutate: () => void) => Promise<boolean>
  /** Archive the entries before deleting them; the memory agent only deletes. */
  archive: boolean
  memoryAgent: () => { enqueue(job: unknown): Promise<unknown> }
  /** Test hook that runs after each state is recorded. */
  afterState?: (state: string) => Promise<void>
  now?: () => number
}

/**
 * Take the unfinished run, or prepare a new one, one state further each step until its rows are
 * deleted. `deferred` means the delete checks failed; retry after PRUNE_RETRY_MS.
 */
export async function pruneOnce(
  deps: PruneDeps,
  options: { force?: boolean } = {},
): Promise<PruneOutcome> {
  const local = await deps.local()
  const limits = await pruneLimits(deps.storage)
  let run = unfinishedRun(local)
  if (run === undefined) {
    if (!options.force && deps.storage.sql.databaseSize <= limits.thresholdBytes) return 'nothing'
    run = await prepare(deps, local, limits)
    if (run === undefined) return 'nothing'
    await deps.afterState?.(run.state)
  }
  const now = () => deps.now?.() ?? Date.now()
  if (run.state === 'prepared') {
    run = await exportRun(deps, local, run, now())
    await deps.afterState?.(run.state)
  }
  if (run.state === 'exported') {
    run = await catalog(deps, local, run, now())
    await deps.afterState?.(run.state)
  }
  const current = run
  const deleted = await deps.exclusive(
    (harness) => safeToDelete(deps.storage, harness, current),
    () => deleteRows(deps.storage, local, current, now()),
  )
  if (!deleted) return 'deferred'
  await deps.afterState?.('deleted')
  return 'pruned'
}
