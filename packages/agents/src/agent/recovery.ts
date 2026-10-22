/**
 * The `recovery` alarm: armed while Pi has runnable tasks, so work resumes after eviction. Call
 * these through the object's serial queue, so a refresh never clears an alarm that an admission
 * just armed.
 */
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Harness, TaskId } from '@earendil-works/pi-durable'
import { setAlarm } from './alarms.ts'

const RECOVERY_DELAY_MS = 60_000

/** Persist a wakeup before admitting work that the scheduler will run. */
export function armRecovery(storage: DurableObjectStorage): Promise<void> {
  return setAlarm(storage, 'recovery', Date.now() + RECOVERY_DELAY_MS)
}

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

/** Arm the alarm and watch each runnable task, or clear it and run `onIdle` when none is left. */
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
      .catch((error: unknown) => console.error('Agent recovery failed', error))
      .finally(() => watching.delete(id))
  }
}
