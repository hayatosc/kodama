/** Reservation admission, receipt recovery, and bounded dispatch for a working agent.
 * @see docs/agents.md — Scheduled tasks
 * @module
 */
import { LiveDoc, ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import type { Harness, SubmissionDraft, ToolExecutionApi } from '@earendil-works/pi-durable'
import type { Context } from '@earendil-works/chord/context'
import * as v from 'valibot'
import type { LocalDb } from './local-db/local.ts'
import {
  cancelReservation,
  claimOccurrence,
  dueReservations,
  insertReservation,
  listReservations,
  markAdmissionStarted,
  nextScheduleWake,
  pendingOccurrences,
  recordAccepted,
  reservationReplay,
  retainScheduledReceipts,
  retryOccurrence,
  settleOccurrence,
} from './local-db/scheduled-tasks.ts'
import type { ScheduledOccurrence, ScheduledTask } from './local-db/scheduled-tasks.ts'
import { latestAtOrBefore, nextAfter, normalizeSchedule, ScheduleSchema } from './schedule-spec.ts'
import { currentRunInputs } from './runtime/inputs.ts'
import { setAlarm, setAlarmNoLaterThan } from './runtime/alarms.ts'
import { submissionOf } from './runtime/views.ts'
import type { ScheduleCall } from '../tools/scheduled-tasks.ts'

const CreateSchema = v.object({
  schedule: ScheduleSchema,
  instruction: v.pipe(v.string(), v.minLength(1), v.maxLength(16000)),
})

/** Arm before any durable mutation; an orphan wake is harmless, a missing wake is not. */
export function armScheduling(storage: DurableObjectStorage): Promise<void> {
  return setAlarmNoLaterThan(storage, 'schedule', Date.now() + 60_000)
}

/** Only adopted owner-only executions can mutate, bound to the still-running tool and input set. */
export async function mutateSchedule(
  local: LocalDb,
  harness: Harness,
  call: Exclude<ScheduleCall, { operation: 'list' }>,
  api: Pick<ToolExecutionApi, 'taskId' | 'conversationId'>,
  invocation: Context,
  checkAllowed: () => void,
): Promise<unknown> {
  invocation.abortSignal?.throwIfAborted()
  if (api.conversationId !== ROOT_CONVERSATION_ID) throw new Error('schedule_owner_required')
  const live = await harness.snapshot(LiveDoc, ROOT_CONVERSATION_ID, invocation)
  const inputs = await currentRunInputs(harness, invocation)
  if (
    !live?.run ||
    !inputs?.length ||
    inputs.some((entry) => entry.kind !== 'kodama.owner-message' && entry.kind !== 'pi.user')
  )
    throw new Error('schedule_owner_required: current execution must contain only owner input')
  const runId = live.run.taskId
  const inputIds = JSON.stringify(live.run.inputs)
  return harness.commit(async (tx) => {
    const current = await tx.doc(LiveDoc, ROOT_CONVERSATION_ID)
    if (
      current.run?.taskId !== runId ||
      JSON.stringify(current.run.inputs) !== inputIds ||
      ![...(current.tools ?? []), ...(current.nestedTools ?? [])].some(
        (tool) => tool.taskId === api.taskId && tool.status === 'running',
      )
    )
      throw new Error('schedule_execution_changed')
    invocation.abortSignal?.throwIfAborted()
    checkAllowed()
    if (call.operation === 'cancel') return cancelReservation(local, call.task_id)
    const input = v.parse(CreateSchema, call)
    const args = JSON.stringify(input)
    const replay = reservationReplay(local, String(api.taskId), args)
    if (replay) return replay
    const now = Date.now()
    const rule = normalizeSchedule(input.schedule, now)
    const first = nextAfter(rule, rule.start - 1)
    if (first === undefined) throw new TypeError('schedule_empty')
    return insertReservation(
      local,
      {
        sourceTask: String(api.taskId),
        sourceEntry: Math.max(...inputs.map((entry) => entry.id)),
        arguments: args,
        instruction: input.instruction,
        rule,
        nextDue: first,
      },
      now,
    )
  }, invocation)
}

/** Read-only listing is available to scheduled and peer runs too. */
export function readSchedules(local: LocalDb, call: Extract<ScheduleCall, { operation: 'list' }>) {
  return listReservations(local, call.filter, call.cursor)
}

/** Persist terminal evidence before pruning, and repair acceptance interrupted before its receipt. */
export async function reconcileSchedules(
  local: LocalDb,
  harness: Harness,
  now = Date.now(),
): Promise<void> {
  for (const { occurrence } of pendingOccurrences(local)) {
    const status = await submissionOf(harness, occurrence.id)
    if (!status) continue
    if (status.status === 'done' || status.status === 'unanswered')
      settleOccurrence(
        local,
        occurrence,
        status.status === 'done' ? 'done' : `unanswered:${status.reason}`,
        now,
      )
    else recordAccepted(local, occurrence.id, status.id, now)
  }
}

/** Recompute from durable domain state, including blocked receipts, after every mutation or wake. */
export async function rearmScheduling(
  local: LocalDb,
  storage: DurableObjectStorage,
): Promise<void> {
  await setAlarm(storage, 'schedule', nextScheduleWake(local))
}

/** A scheduled input is never owner authorization and never grants URLs from its instruction. */
export function scheduledDraft(
  task: ScheduledTask,
  occurrence: ScheduledOccurrence,
): SubmissionDraft {
  return {
    type: 'input',
    requestId: occurrence.id,
    whenBusy: 'followUp',
    content: `[Scheduled task ${task.id}; nominal time ${new Date(occurrence.nominalAt).toISOString()}. This is scheduled work, not a new owner message. Do not create or cancel reservations.]\n${task.instruction}`,
    entry: {
      kind: 'kodama.scheduled-message',
      data: { taskId: task.id, nominalAt: occurrence.nominalAt, hop: 0 },
    },
  }
}

/** Fixed classification; never persist provider errors, credentials or arbitrary exception bodies. */
function permanentRefusal(error: unknown): boolean {
  return (
    error instanceof Error &&
    /^(schedule_disabled|agent_restricted|agent_unavailable:|Unknown agent:|credential_unavailable:.*(?:needs_reauth|no usable assigned credential|missing|not granted|revoked|disabled))/.test(
      error.message,
    )
  )
}

/** Deliver at most ten claims, releasing the object's serial queue before normal admission. */
export async function dispatchSchedules(
  local: LocalDb,
  harness: Harness,
  storage: DurableObjectStorage,
  serialize: <T>(operation: () => Promise<T>) => Promise<T>,
  prepare: () => Promise<void>,
  admit: (draft: SubmissionDraft) => Promise<unknown>,
): Promise<void> {
  await serialize(async () => {
    await reconcileSchedules(local, harness)
    for (const task of dueReservations(local, Date.now())) {
      const at = latestAtOrBefore(task.rule, Date.now())
      if (at === undefined || (task.cursor !== null && at <= task.cursor))
        throw new Error('schedule_cursor_invalid')
      claimOccurrence(local, task, at, nextAfter(task.rule, at), Date.now())
    }
  })
  for (const { task, occurrence } of pendingOccurrences(local, Date.now()).slice(0, 10)) {
    let prepared = false
    try {
      // Always look for existing acceptance before applying today's admission restrictions.
      const existing = await submissionOf(harness, occurrence.id)
      if (!existing && occurrence.state === 'submitted') {
        await serialize(async () => {
          retryOccurrence(local, occurrence, Date.now())
        })
        continue
      }
      if (!existing) {
        await prepare()
        await serialize(async () => {
          markAdmissionStarted(local, occurrence.id)
        })
        prepared = true
        await admit(scheduledDraft(task, occurrence))
      }
      await serialize(() => reconcileSchedules(local, harness))
    } catch (error) {
      await serialize(async () => {
        const accepted = await submissionOf(harness, occurrence.id)
        if (accepted) {
          await reconcileSchedules(local, harness)
          return
        }
        // Once admission started, absence is not proof of nonacceptance after a storage failure.
        if (
          !prepared &&
          !occurrence.admissionStarted &&
          (permanentRefusal(error) || occurrence.attempts >= 4)
        )
          settleOccurrence(
            local,
            occurrence,
            permanentRefusal(error) ? 'admission_refused' : 'admission_retry_exhausted',
            Date.now(),
            true,
          )
        else retryOccurrence(local, occurrence, Date.now())
      })
    }
  }
  await serialize(async () => {
    retainScheduledReceipts(local, Date.now())
    await rearmScheduling(local, storage)
  })
}
