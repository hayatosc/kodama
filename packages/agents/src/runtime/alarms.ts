/**
 * The object's one platform alarm, shared by several purposes, and the recovery alarm.
 *
 * Each purpose keeps its due time in the object's storage, and the platform alarm points at the
 * earliest. Times are read and written with the synchronous storage API, so two updates never
 * interleave, and each one sets the alarm from the state it just wrote.
 *
 * @see docs/agents.md — Alarms and recovery
 *
 * @module
 */
import { safeFailure } from '../lib/redaction.ts'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Harness, TaskId } from '@earendil-works/pi-durable'

/** Why an object wants to be woken. */
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

/**
 * Wake for `purpose` at `at`, or no longer when `at` is undefined.
 *
 * @param at - Epoch milliseconds.
 */
export function setAlarm(
  storage: DurableObjectStorage,
  purpose: AlarmPurpose,
  at: number | undefined,
): Promise<void> {
  if (at === undefined) storage.kv.delete(KEY_PREFIX + purpose)
  else storage.kv.put(KEY_PREFIX + purpose, at)
  return syncAlarm(storage)
}

/** When `purpose` is due, or undefined when it is not scheduled. */
export function alarmAt(storage: DurableObjectStorage, purpose: AlarmPurpose): number | undefined {
  return storage.kv.get<number>(KEY_PREFIX + purpose)
}

/** Wake for `purpose` at `at`, unless it is already due earlier. */
export async function setAlarmNoLaterThan(
  storage: DurableObjectStorage,
  purpose: AlarmPurpose,
  at: number,
): Promise<void> {
  const current = alarmAt(storage, purpose)
  if (current !== undefined && current <= at) return
  await setAlarm(storage, purpose, at)
}

/**
 * Remove the purposes due at `now` and point the alarm at the next one.
 *
 * @returns The purposes that were due.
 */
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

/** How long after admission the recovery alarm wakes the object if work is still pending. */
const RECOVERY_DELAY_MS = 60_000

/**
 * Persist a recovery wakeup.
 *
 * @remarks
 * Call it before admitting work that Pi's scheduler will run, so the work resumes after an
 * eviction even if the object stops right after admission.
 */
export function armRecovery(storage: DurableObjectStorage): Promise<void> {
  return setAlarm(storage, 'recovery', Date.now() + RECOVERY_DELAY_MS)
}

/** What {@link refreshRecovery} needs from the object. */
export interface RecoveryRefresh {
  harness: Harness
  storage: DurableObjectStorage
  /** Tasks already watched, kept by the object across refreshes. */
  watching: Set<TaskId>
  /** Runs when the refresh finds no runnable task. */
  onIdle: () => Promise<void>
  /** Refresh again, through the serial queue, when a watched task ends. */
  refreshAgain: () => Promise<void>
}

/**
 * Keep the recovery alarm in step with Pi's tasks.
 *
 * With runnable tasks, arm the alarm and watch each task, refreshing again when it ends. With
 * none, clear the alarm and run `onIdle`.
 *
 * @remarks
 * Run it in the object's serial queue, together with admissions, so a refresh never clears an
 * alarm that an admission just armed.
 */
export async function refreshRecovery(refresh: RecoveryRefresh): Promise<void> {
  const { harness, watching } = refresh
  const { tasks } = await harness.inspect(BACKGROUND_CONTEXT)
  const runnable = tasks.filter((task) => task.state.kind !== 'blocked')
  if (runnable.length === 0) {
    await setAlarm(refresh.storage, 'recovery', undefined)
    await refresh.onIdle()
    return
  }
  await armRecovery(refresh.storage)
  // waitForTask enables Pi's scheduler; the recovery alarm must already be durable.
  for (const task of runnable) {
    const id = task.record.id
    if (watching.has(id)) continue
    watching.add(id)
    void harness
      .waitForTask(id, BACKGROUND_CONTEXT)
      .then(refresh.refreshAgain)
      .catch((error: unknown) => console.error('Agent recovery failed', safeFailure(error)))
      .finally(() => watching.delete(id))
  }
}
