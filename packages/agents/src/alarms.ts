/** Why an object wants to be woken. One Durable Object alarm serves all of them. */
export type AlarmPurpose = 'recovery' | 'extract' | 'prune' | 'jobs'

const KEY_PREFIX = 'kodama:alarm:'
const PURPOSES: readonly AlarmPurpose[] = ['recovery', 'extract', 'prune', 'jobs']

/**
 * Keeps one due time per purpose in the object's storage and the platform alarm at the earliest
 * (docs/design/long-term-memory.md, Alarms). Changes run one at a time.
 */
export class AlarmSchedule {
  readonly #storage: DurableObjectStorage
  #queue: Promise<void> = Promise.resolve()

  constructor(storage: DurableObjectStorage) {
    this.#storage = storage
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(operation, operation)
    this.#queue = run.then(
      () => {},
      () => {},
    )
    return run
  }

  async #due(): Promise<Map<AlarmPurpose, number>> {
    const due = new Map<AlarmPurpose, number>()
    for (const purpose of PURPOSES) {
      const at = await this.#storage.get<number>(KEY_PREFIX + purpose)
      if (at !== undefined) due.set(purpose, at)
    }
    return due
  }

  async #sync(): Promise<void> {
    const times = [...(await this.#due()).values()]
    if (times.length === 0) await this.#storage.deleteAlarm()
    else await this.#storage.setAlarm(Math.min(...times))
  }

  /** Wake for `purpose` at `at` (epoch ms), or no longer when `at` is undefined. */
  set(purpose: AlarmPurpose, at: number | undefined): Promise<void> {
    return this.#serialize(async () => {
      if (at === undefined) await this.#storage.delete(KEY_PREFIX + purpose)
      else await this.#storage.put(KEY_PREFIX + purpose, at)
      await this.#sync()
    })
  }

  /** When `purpose` is due, if it is scheduled. */
  get(purpose: AlarmPurpose): Promise<number | undefined> {
    return this.#serialize(() => this.#storage.get<number>(KEY_PREFIX + purpose))
  }

  /** Wake for `purpose` at `at` unless it is already due earlier. */
  setNoLaterThan(purpose: AlarmPurpose, at: number): Promise<void> {
    return this.#serialize(async () => {
      const current = await this.#storage.get<number>(KEY_PREFIX + purpose)
      if (current !== undefined && current <= at) return
      await this.#storage.put(KEY_PREFIX + purpose, at)
      await this.#sync()
    })
  }

  /** Remove and return the purposes due at `now`; the alarm moves to the next one. */
  take(now: number): Promise<AlarmPurpose[]> {
    return this.#serialize(async () => {
      const taken: AlarmPurpose[] = []
      for (const [purpose, at] of await this.#due()) {
        if (at > now) continue
        taken.push(purpose)
        await this.#storage.delete(KEY_PREFIX + purpose)
      }
      await this.#sync()
      return taken
    })
  }
}
