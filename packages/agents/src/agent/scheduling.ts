/** Reservation admission, receipt recovery, and bounded dispatch for a working agent.
 * @see docs/agents.md — Scheduled tasks
 * @module
 */
import { LiveDoc, ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import type { Harness, SubmissionDraft, ToolExecutionApi } from '@earendil-works/pi-durable'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Context } from '@earendil-works/chord/context'
import * as v from 'valibot'
import type { LocalDb } from './local-db/local.ts'
import { nextNotificationExpiry, retainNotifications } from './local-db/notifications.ts'
import {
  cancelReservation,
  claimOccurrence,
  deferOccurrence,
  dueReservations,
  getReservation,
  insertReservation,
  listReservations,
  markAdmissionStarted,
  MAX_FOLLOWUP_HOPS,
  nextScheduleWake,
  pendingOccurrences,
  recordAccepted,
  reservationReplay,
  retainScheduledReceipts,
  retryOccurrence,
  settleOccurrence,
  updateReservation,
} from './local-db/scheduled-tasks.ts'
import type { ScheduledOccurrence, ScheduledTask } from './local-db/scheduled-tasks.ts'
import { latestAtOrBefore, nextAfter, normalizeSchedule, ScheduleSchema } from './schedule-spec.ts'
import { currentRunInputs } from './runtime/inputs.ts'
import { setAlarm, setAlarmNoLaterThan } from './runtime/alarms.ts'
import { isIdle } from './runtime/harness.ts'
import { submissionOf } from './runtime/views.ts'
import { latestEntryId } from '../memory/transcript.ts'
import type { ScheduleCall } from '../tools/scheduled-tasks.ts'

const CreateSchema = v.object({
  schedule: ScheduleSchema,
  instruction: v.pipe(v.string(), v.minLength(1), v.maxLength(16000)),
  session_mode: v.optional(v.picklist(['new', 'resume'])),
})

const UpdateSchema = v.pipe(
  v.object({
    task_id: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
    action: v.optional(v.picklist(['pause', 'resume', 'edit'])),
    instruction: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(16000))),
    schedule: v.optional(ScheduleSchema),
  }),
  v.check(
    (u) => u.action !== undefined || u.instruction !== undefined || u.schedule !== undefined,
    'schedule_update: provide action, instruction, or schedule',
  ),
)

/** Arm before any durable mutation; an orphan wake is harmless, a missing wake is not. */
export function armScheduling(storage: DurableObjectStorage): Promise<void> {
  return setAlarmNoLaterThan(storage, 'schedule', Date.now() + 60_000)
}

function readHop(data: unknown): number {
  if (!data || typeof data !== 'object' || !('hop' in data)) return 0
  return typeof data.hop === 'number' && Number.isInteger(data.hop) && data.hop >= 0 ? data.hop : 0
}

/**
 * Owner-only executions can create or modify any schedule; autonomous executions may reserve or
 * manage bounded one-time follow-ups (`once`, up to `MAX_FOLLOWUP_HOPS`).
 */
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
  if (!live?.run || !inputs?.length)
    throw new Error('schedule_owner_required: current execution must contain input provenance')
  const ownerOnly = inputs.every(
    (entry) => entry.kind === 'kodama.operator-message' || entry.kind === 'pi.user',
  )
  if (!ownerOnly && call.operation === 'create' && call.schedule.kind !== 'once') {
    throw new Error('schedule_owner_required: current execution must contain only owner input')
  }
  const currentHop = Math.max(0, ...inputs.map((entry) => readHop(entry.data)))
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
    if (call.operation === 'cancel') {
      if (!ownerOnly) {
        const target = getReservation(local, call.task_id)
        if (target && target.category !== 'followup') {
          throw new Error('schedule_owner_required: only follow-up timers can be cancelled here')
        }
      }
      return cancelReservation(local, call.task_id)
    }
    if (call.operation === 'update') {
      const input = v.parse(UpdateSchema, call)
      const target = getReservation(local, input.task_id)
      if (!target) return { status: 'not_found' }
      if (!ownerOnly && target.category !== 'followup') {
        throw new Error('schedule_owner_required: current execution must contain only owner input')
      }
      if (!ownerOnly && input.schedule && input.schedule.kind !== 'once') {
        throw new Error('schedule_owner_required: autonomous updates only allow kind once')
      }
      const now = Date.now()
      const rule = input.schedule ? normalizeSchedule(input.schedule, now) : undefined
      let nextDue: number | null | undefined = undefined
      if (rule) {
        const first = nextAfter(rule, rule.start - 1)
        if (first === undefined) throw new TypeError('schedule_empty')
        nextDue = first
      } else if (input.action === 'resume') {
        const anchor = Math.max(now, target.cursor ?? target.rule.start - 1)
        const resumed = nextAfter(target.rule, anchor)
        if (resumed === undefined) throw new TypeError('schedule_empty')
        nextDue = resumed
      }
      return updateReservation(local, input.task_id, {
        ...(input.action === undefined ? {} : { action: input.action }),
        ...(input.instruction === undefined ? {} : { instruction: input.instruction }),
        ...(rule === undefined ? {} : { rule }),
        ...(nextDue === undefined ? {} : { nextDue }),
      })
    }
    const input = v.parse(CreateSchema, call)
    if (!ownerOnly && input.schedule.kind !== 'once') {
      throw new Error('schedule_owner_required: current execution must contain only owner input')
    }
    const args = JSON.stringify(input)
    const replay = reservationReplay(local, String(api.taskId), args)
    if (replay) return replay
    const nextHop = ownerOnly ? 0 : currentHop + 1
    if (!ownerOnly && nextHop > MAX_FOLLOWUP_HOPS) {
      throw new Error(
        `schedule_followup_limit: maximum ${MAX_FOLLOWUP_HOPS} autonomous follow-up hops reached`,
      )
    }
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
        category: ownerOnly ? 'schedule' : 'followup',
        followupHop: nextHop,
        sessionMode: input.session_mode ?? 'new',
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
  retainNotifications(local, Date.now())
  const deadlines = [nextScheduleWake(local), nextNotificationExpiry(local)].filter(
    (at): at is number => at !== undefined,
  )
  await setAlarm(storage, 'schedule', deadlines.length ? Math.min(...deadlines) : undefined)
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
    content: `[Scheduled ${task.category} ${task.id}; nominal time ${new Date(occurrence.nominalAt).toISOString()}; follow-up hop ${task.followupHop}/${MAX_FOLLOWUP_HOPS}. This is scheduled work, not a new owner message. Call send_outbox only if there is an actionable alert or result for the operator; otherwise finish silently without notifying. You may schedule a one-time follow-up (kind: 'once') within the hop limit, but do not create recurring schedules without owner instruction.]\n${task.instruction}`,
    entry: {
      kind: 'kodama.scheduled-message',
      data: { taskId: task.id, nominalAt: occurrence.nominalAt, hop: task.followupHop },
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
        if (task.sessionMode === 'new') {
          if (!(await isIdle(harness))) {
            // Wait until the active session finishes before resetting the model context.
            await serialize(async () => {
              deferOccurrence(local, occurrence, Date.now() + 5_000)
            })
            continue
          }
          if ((await latestEntryId(harness)) !== undefined) {
            const root = await harness.root(BACKGROUND_CONTEXT)
            await root.reset(undefined, BACKGROUND_CONTEXT)
          }
        }
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
