/**
 * The object's one platform alarm, shared by several purposes, and the recovery alarm.
 *
 * Each purpose has a pending deadline and, while executing, a durable retry claim. An atomic
 * storage transaction updates these and the platform alarm together; completion acknowledges
 * only its claim, never a newly scheduled deadline.
 *
 * @see docs/agents.md — Alarms and recovery
 *
 * @module
 */
import { safeFailure } from '../../lib/errors.ts'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Harness, TaskId } from '@earendil-works/pi-durable'

/** Why an object wants to be woken. */
export type AlarmPurpose = 'recovery' | 'schedule' | 'extract' | 'prune' | 'jobs'

const KEY_PREFIX = 'kodama:alarm:'
const PURPOSES: readonly AlarmPurpose[] = ['recovery', 'schedule', 'extract', 'jobs', 'prune']
const CLAIM_PREFIX = 'kodama:alarm-claim:'
const RETRY_MS = 60_000

/** A durable wake lease, separate from a purpose's next pending deadline. */
export interface AlarmClaim {
  purpose: AlarmPurpose
  id: string
  retryAt: number
}

async function syncAlarm(tx: DurableObjectTransaction): Promise<void> {
  const times: number[] = []
  for (const purpose of PURPOSES) {
    const claim = await tx.get<AlarmClaim>(CLAIM_PREFIX + purpose)
    const pending = await tx.get<number>(KEY_PREFIX + purpose)
    // A live claim owns this purpose until its retry deadline, even if another wake arrives.
    const at = claim?.retryAt ?? pending
    if (at !== undefined) times.push(at)
  }
  if (times.length === 0) await tx.deleteAlarm()
  else await tx.setAlarm(Math.min(...times))
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
  return storage.transaction(async (tx) => {
    if (at === undefined) await tx.delete(KEY_PREFIX + purpose)
    else await tx.put(KEY_PREFIX + purpose, at)
    await syncAlarm(tx)
  })
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
  await storage.transaction(async (tx) => {
    const current = await tx.get<number>(KEY_PREFIX + purpose)
    if (current === undefined || current > at) await tx.put(KEY_PREFIX + purpose, at)
    await syncAlarm(tx)
  })
}

/** Claim due purposes and persist retry wakes before any handler can have effects. */
export async function claimDueAlarms(
  storage: DurableObjectStorage,
  now: number,
): Promise<AlarmClaim[]> {
  return storage.transaction(async (tx) => {
    const due: { purpose: AlarmPurpose; at: number; retry: boolean }[] = []
    for (const purpose of PURPOSES) {
      const claim = await tx.get<AlarmClaim>(CLAIM_PREFIX + purpose)
      const pending = await tx.get<number>(KEY_PREFIX + purpose)
      const at = claim?.retryAt ?? pending
      if (at !== undefined && at <= now) due.push({ purpose, at, retry: claim !== undefined })
    }
    due.sort((a, b) => a.at - b.at)
    const claims: AlarmClaim[] = []
    for (const { purpose, retry } of due) {
      const claim = { purpose, id: crypto.randomUUID(), retryAt: now + RETRY_MS }
      // A retry must not consume a pending deadline registered during the previous attempt.
      if (!retry) await tx.delete(KEY_PREFIX + purpose)
      await tx.put(CLAIM_PREFIX + purpose, claim)
      claims.push(claim)
    }
    await syncAlarm(tx)
    return claims
  })
}

/** Acknowledge this attempt only; stale completions cannot delete a newer claim or deadline. */
export async function acknowledgeAlarm(
  storage: DurableObjectStorage,
  claim: AlarmClaim,
): Promise<void> {
  await storage.transaction(async (tx) => {
    const current = await tx.get<AlarmClaim>(CLAIM_PREFIX + claim.purpose)
    if (current?.id === claim.id) await tx.delete(CLAIM_PREFIX + claim.purpose)
    await syncAlarm(tx)
  })
}

/** Isolate domain failures; storage failures in claim/ack still reach the platform. */
export async function dispatchAlarms(
  storage: DurableObjectStorage,
  now: number,
  handle: (purpose: AlarmPurpose) => Promise<void>,
): Promise<void> {
  for (const claim of await claimDueAlarms(storage, now)) {
    try {
      await handle(claim.purpose)
    } catch (error) {
      console.error('Alarm purpose failed', claim.purpose, safeFailure(error))
      continue
    }
    await acknowledgeAlarm(storage, claim)
  }
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
