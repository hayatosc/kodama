/**
 * One due time per purpose in the object's storage, with the platform alarm at the earliest
 * (docs/memory.md, Alarms). Times are read and written with the synchronous storage API, so two
 * updates never interleave, and each one sets the alarm from the state it just wrote.
 */

/** Why an object wants to be woken. One Durable Object alarm serves all of them. */
export type AlarmPurpose = 'recovery' | 'extract' | 'prune' | 'jobs'

const KEY_PREFIX = 'kodama:alarm:'
const PURPOSES: readonly AlarmPurpose[] = ['recovery', 'extract', 'prune', 'jobs']

function dueTimes(storage: DurableObjectStorage): Map<AlarmPurpose, number> {
  const due = new Map<AlarmPurpose, number>()
  for (const purpose of PURPOSES) {
    const at = storage.kv.get<number>(KEY_PREFIX + purpose)
    if (at !== undefined) due.set(purpose, at)
  }
  return due
}

/** Point the platform alarm at the earliest due time, or clear it. */
function syncAlarm(storage: DurableObjectStorage): Promise<void> {
  const times = [...dueTimes(storage).values()]
  return times.length === 0 ? storage.deleteAlarm() : storage.setAlarm(Math.min(...times))
}

/** Wake for `purpose` at `at` (epoch ms), or no longer when `at` is undefined. */
export function setAlarm(
  storage: DurableObjectStorage,
  purpose: AlarmPurpose,
  at: number | undefined,
): Promise<void> {
  if (at === undefined) storage.kv.delete(KEY_PREFIX + purpose)
  else storage.kv.put(KEY_PREFIX + purpose, at)
  return syncAlarm(storage)
}

/** When `purpose` is due, if it is scheduled. */
export function alarmAt(storage: DurableObjectStorage, purpose: AlarmPurpose): number | undefined {
  return storage.kv.get<number>(KEY_PREFIX + purpose)
}

/** Wake for `purpose` at `at` unless it is already due earlier. */
export async function setAlarmNoLaterThan(
  storage: DurableObjectStorage,
  purpose: AlarmPurpose,
  at: number,
): Promise<void> {
  const current = alarmAt(storage, purpose)
  if (current !== undefined && current <= at) return
  await setAlarm(storage, purpose, at)
}

/** Remove and return the purposes due at `now`; the alarm moves to the next one. */
export async function takeDueAlarms(
  storage: DurableObjectStorage,
  now: number,
): Promise<AlarmPurpose[]> {
  const taken: AlarmPurpose[] = []
  for (const [purpose, at] of dueTimes(storage)) {
    if (at > now) continue
    taken.push(purpose)
    storage.kv.delete(KEY_PREFIX + purpose)
  }
  await syncAlarm(storage)
  return taken
}
