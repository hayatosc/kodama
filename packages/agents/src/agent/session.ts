/** The Pi harness of one agent object: opening it, and swapping it in an exclusive section. */
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { Harness } from '@earendil-works/pi-durable'
import type { HarnessOptions } from '@earendil-works/pi-durable'
import { openDurableObjectSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/cloudflare'

const context = BACKGROUND_CONTEXT

export interface SessionSetup {
  /** Called on every open, so subclasses supply their own registry and settings. */
  options: () => HarnessOptions
  /** Runs on every open, before any request sees the harness. */
  prepare: (harness: Harness) => Promise<void>
}

async function openHarness(ctx: DurableObjectState, options: HarnessOptions): Promise<Harness> {
  const storage = await openDurableObjectSqliteStorage(ctx.storage)
  const harness = await Harness.open(
    storage,
    { ...options, onReport: (error) => console.error('Agent background task failed', error) },
    context,
  )
  void harness.closed.then((end) => {
    if (end.reason === 'failed') ctx.abort('Agent storage failed')
  })
  return harness
}

/** No task is left and no input or write is queued. */
export async function isIdle(harness: Harness): Promise<boolean> {
  const { tasks, submissions } = await harness.inspect(context)
  return tasks.length === 0 && submissions.length === 0
}

export class AgentSession {
  readonly #ctx: DurableObjectState
  readonly #setup: SessionSetup
  #harness: Promise<Harness>

  /** Opens the harness once `ready` resolves, with every request held back until it is open. */
  constructor(ctx: DurableObjectState, setup: SessionSetup, ready: Promise<unknown>) {
    this.#ctx = ctx
    this.#setup = setup
    this.#harness = ctx.blockConcurrencyWhile(async () => {
      await ready
      return this.#open()
    })
  }

  /** The open harness; after an exclusive section, the reopened one. */
  harness(): Promise<Harness> {
    return this.#harness
  }

  async #open(): Promise<Harness> {
    const harness = await openHarness(this.#ctx, this.#setup.options())
    try {
      await this.#setup.prepare(harness)
      return harness
    } catch (error) {
      await harness.close(context)
      throw error
    }
  }

  /**
   * Run `check` against the open harness with every other event held back; if it passes, close the
   * harness, run `mutate` in one storage transaction, and open the harness again.
   */
  async exclusive(
    check: (harness: Harness) => Promise<boolean>,
    mutate: () => void,
  ): Promise<boolean> {
    const previous = this.#harness
    let mutated = false
    this.#harness = this.#ctx.blockConcurrencyWhile(async () => {
      const harness = await previous
      if (!(await check(harness))) return harness
      await harness.close(context)
      // A failure here throws out of blockConcurrencyWhile, which resets the object.
      this.#ctx.storage.transactionSync(mutate)
      mutated = true
      return this.#open()
    })
    await this.#harness
    return mutated
  }
}
