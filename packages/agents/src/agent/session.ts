/** The Pi harness of one agent object: opening it, and swapping it in an exclusive section. */
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { Harness } from '@earendil-works/pi-durable'
import type { HarnessOptions } from '@earendil-works/pi-durable'
import { openDurableObjectSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/cloudflare'

const context = BACKGROUND_CONTEXT

/** Open the harness and run `prepare` before anything else sees it; close it if that fails. */
export async function openHarness(
  ctx: DurableObjectState,
  options: HarnessOptions,
  prepare: (harness: Harness) => Promise<void>,
): Promise<Harness> {
  const storage = await openDurableObjectSqliteStorage(ctx.storage)
  const harness = await Harness.open(
    storage,
    { ...options, onReport: (error) => console.error('Agent background task failed', error) },
    context,
  )
  void harness.closed.then((end) => {
    if (end.reason === 'failed') ctx.abort('Agent storage failed')
  })
  try {
    await prepare(harness)
    return harness
  } catch (error) {
    await harness.close(context)
    throw error
  }
}

/** No task is left and no input or write is queued. */
export async function isIdle(harness: Harness): Promise<boolean> {
  const { tasks, submissions } = await harness.inspect(context)
  return tasks.length === 0 && submissions.length === 0
}

/**
 * With every other event held back, run `check` against the open harness; if it passes, close the
 * harness, run `mutate` in one storage transaction, and `reopen` it. Resolves with the harness to
 * use from now on.
 */
export function exclusiveSection(
  ctx: DurableObjectState,
  current: Promise<Harness>,
  check: (harness: Harness) => Promise<boolean>,
  mutate: () => void,
  reopen: () => Promise<Harness>,
): Promise<{ harness: Harness; mutated: boolean }> {
  return ctx.blockConcurrencyWhile(async () => {
    const harness = await current
    if (!(await check(harness))) return { harness, mutated: false }
    await harness.close(context)
    // A failure here throws out of blockConcurrencyWhile, which resets the object.
    ctx.storage.transactionSync(mutate)
    return { harness: await reopen(), mutated: true }
  })
}
