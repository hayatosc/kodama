import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Harness, TaskId } from '@earendil-works/pi-durable'
import type { AlarmSchedule } from './alarms.ts'

const RECOVERY_DELAY_MS = 60_000

/**
 * Keeps the `recovery` alarm armed while Pi has runnable tasks, so work resumes after eviction.
 * Alarm changes and operations that depend on them run one at a time.
 */
export class RecoveryAlarm {
  readonly #alarms: AlarmSchedule
  readonly #onIdle: () => Promise<void>
  readonly #watching = new Set<TaskId>()
  #queue: Promise<void> = Promise.resolve()

  /** `onIdle` runs whenever a refresh finds no runnable task. */
  constructor(alarms: AlarmSchedule, onIdle: () => Promise<void> = () => Promise.resolve()) {
    this.#alarms = alarms
    this.#onIdle = onIdle
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
    return this.#alarms.set('recovery', Date.now() + RECOVERY_DELAY_MS)
  }

  refresh(harness: Harness): Promise<void> {
    return this.serialize(async () => {
      const { tasks } = await harness.inspect(BACKGROUND_CONTEXT)
      const runnable = tasks.filter((task) => task.state.kind !== 'blocked')
      if (runnable.length === 0) {
        await this.#alarms.set('recovery', undefined)
        await this.#onIdle()
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
