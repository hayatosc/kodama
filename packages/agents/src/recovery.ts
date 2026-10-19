import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Harness, TaskId } from '@earendil-works/pi-durable'

const RECOVERY_DELAY_MS = 60_000

/**
 * Keeps a Durable Object alarm armed while Pi has runnable tasks, so work resumes after eviction.
 * Alarm changes and operations that depend on them run one at a time.
 */
export class RecoveryAlarm {
  readonly #storage: DurableObjectStorage
  readonly #watching = new Set<TaskId>()
  #queue: Promise<void> = Promise.resolve()

  constructor(storage: DurableObjectStorage) {
    this.#storage = storage
  }

  /** Run after every earlier alarm update settles, whether it succeeded or failed. */
  serialize<T>(operation: () => Promise<T>): Promise<T> {
    const update = this.#queue.then(operation, operation)
    this.#queue = update.then(
      () => {},
      () => {},
    )
    return update
  }

  /** Persist a wakeup; call inside `serialize` before admitting work that the scheduler will run. */
  arm(): Promise<void> {
    return this.#storage.setAlarm(Date.now() + RECOVERY_DELAY_MS)
  }

  refresh(harness: Harness): Promise<void> {
    return this.serialize(async () => {
      const { tasks } = await harness.inspect(BACKGROUND_CONTEXT)
      const runnable = tasks.filter((task) => task.state.kind !== 'blocked')
      if (runnable.length === 0) {
        await this.#storage.deleteAlarm()
        return
      }
      await this.arm()
      // waitForTask enables Pi's scheduler; the recovery alarm must already be durable.
      for (const task of runnable) {
        const id = task.record.id
        if (this.#watching.has(id)) continue
        this.#watching.add(id)
        void harness
          .waitForTask(id, BACKGROUND_CONTEXT)
          .then(() => this.refresh(harness))
          .catch((error: unknown) => console.error('Agent recovery failed', error))
          .finally(() => this.#watching.delete(id))
      }
    })
  }
}
