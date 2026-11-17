/**
 * Local reservation persistence and atomic cursor transitions; no model or network operations.
 *
 * @see docs/agents.md — Scheduled tasks
 * @module
 */
import * as v from 'valibot'
import { EXTENSION_RETENTION_MS } from '../../extensions.ts'
import { parseEnum, parseJsonValue } from '../../lib/reylo.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import type { ScheduleSpec } from '../schedule-spec.ts'
import type { LocalDb } from './local.ts'
import { insertNotificationRow } from './notifications.repository.ts'
import { queries } from './queries/index.ts'

const TASK_CATEGORIES = ['followup', 'schedule'] as const
const SESSION_MODES = ['resume', 'new'] as const
const TASK_STATES = ['active', 'paused', 'completed', 'cancelled', 'failed'] as const
const OCCURRENCE_STATES = ['dispatching', 'submitted', 'settled', 'failed'] as const

const scheduleSpecSchema = v.variant('kind', [
  v.object({ kind: v.literal('once'), start: v.number() }),
  v.object({
    kind: v.literal('interval'),
    start: v.number(),
    every: v.number(),
    end: v.optional(v.number()),
  }),
  v.object({
    kind: v.literal('cron'),
    start: v.number(),
    expression: v.string(),
    timezone: v.string(),
    end: v.optional(v.number()),
  }),
])

/** Immutable rule and its durable progress. */
export interface ScheduledTask {
  id: string
  sourceTask: string
  sourceEntry: number
  arguments: string
  instruction: string
  rule: ScheduleSpec
  category: (typeof TASK_CATEGORIES)[number]
  followupHop: number
  sessionMode: (typeof SESSION_MODES)[number]
  state: (typeof TASK_STATES)[number]
  nextDue: number | null
  cursor: number | null
  createdAt: number
}

/** A materialized, uniquely addressed execution. */
export interface ScheduledOccurrence {
  id: string
  taskId: string
  nominalAt: number
  coalescedFrom: number
  state: (typeof OCCURRENCE_STATES)[number]
  submissionId: number | null
  admissionStarted: boolean
  retryAt: number
  attempts: number
  outcome: string | null
  settledAt: number | null
}

function parseScheduledTask(row: {
  id: string
  sourceTask: string
  sourceEntry: number
  arguments: string
  instruction: string
  ruleJson: string
  category: string
  followupHop: number
  sessionMode: string
  state: string
  nextDue: number | null
  cursor: number | null
  createdAt: number
}): ScheduledTask {
  return {
    id: row.id,
    sourceTask: row.sourceTask,
    sourceEntry: row.sourceEntry,
    arguments: row.arguments,
    instruction: row.instruction,
    rule: v.parse(scheduleSpecSchema, parseJsonValue(row.ruleJson)),
    category: parseEnum(TASK_CATEGORIES, row.category, 'scheduled task category'),
    followupHop: row.followupHop,
    sessionMode: parseEnum(SESSION_MODES, row.sessionMode, 'scheduled task sessionMode'),
    state: parseEnum(TASK_STATES, row.state, 'scheduled task state'),
    nextDue: row.nextDue,
    cursor: row.cursor,
    createdAt: row.createdAt,
  }
}

function parseScheduledOccurrence(row: {
  id: string
  taskId: string
  nominalAt: number
  coalescedFrom: number
  state: string
  submissionId: number | null
  admissionStarted: boolean
  retryAt: number
  attempts: number
  outcome: string | null
  settledAt: number | null
}): ScheduledOccurrence {
  return {
    ...row,
    state: parseEnum(OCCURRENCE_STATES, row.state, 'scheduled occurrence state'),
  }
}

/** Maximum autonomous follow-up chain depth without owner intervention. */
export const MAX_FOLLOWUP_HOPS = 5
/** Maximum concurrently active follow-up reservations per agent. */
export const MAX_ACTIVE_FOLLOWUPS = 10

/** Read a replay before validating temporal limits or generating a new default anchor. */
export function reservationReplay(
  db: LocalDb,
  sourceTask: string,
  args: string,
): ScheduledTask | undefined {
  const row = queries.getScheduledTaskBySourceTask.runSync(db.sql, { sourceTask })
  if (row === null) return undefined
  const parsed = parseScheduledTask(row)
  if (parsed.arguments !== args) throw new TypeError('schedule_replay_mismatch')
  return parsed
}

/** Read one reservation by ID, if it exists. */
export function getReservation(db: LocalDb, id: string): ScheduledTask | undefined {
  const row = queries.getScheduledTaskById.runSync(db.sql, { id })
  return row === null ? undefined : parseScheduledTask(row)
}

/** Insert under the caller's serialized mutation guard; stopped-but-unsettled definitions count. */
export function insertReservation(
  db: LocalDb,
  input: {
    sourceTask: string
    sourceEntry: number
    arguments: string
    instruction: string
    rule: ScheduleSpec
    nextDue: number
    category?: 'followup' | 'schedule'
    followupHop?: number
    sessionMode?: 'resume' | 'new'
  },
  now: number,
): ScheduledTask {
  return db.transactionSync(() => {
    const open = queries.getOpenScheduledTasksCount.runSync(db.sql).value
    if (open >= 100) throw new Error('schedule_quota: maximum 100 active or unsettled reservations')
    if (input.category === 'followup') {
      const followups = queries.getActiveFollowupTasksCount.runSync(db.sql).value
      if (followups >= MAX_ACTIVE_FOLLOWUPS) {
        throw new Error(
          `schedule_followup_quota: maximum ${MAX_ACTIVE_FOLLOWUPS} active follow-up timers`,
        )
      }
    }
    return parseScheduledTask(
      queries.insertScheduledTask.runSync(db.sql, {
        id: uuidv7(),
        sourceTask: input.sourceTask,
        sourceEntry: input.sourceEntry,
        arguments: input.arguments,
        instruction: input.instruction,
        ruleJson: JSON.stringify(input.rule),
        category: input.category ?? 'schedule',
        followupHop: input.followupHop ?? 0,
        sessionMode: input.sessionMode ?? 'new',
        nextDue: input.nextDue,
        createdAt: now,
      }),
    )
  })
}

/** Stop future materialization without aborting a claimed or admitted execution. */
export function cancelReservation(db: LocalDb, id: string) {
  return db.transactionSync(() => {
    const raw = queries.getScheduledTaskById.runSync(db.sql, { id })
    if (raw === null) return { status: 'not_found' }
    const row = parseScheduledTask(raw)
    const stoppable = row.state === 'active' || row.state === 'paused'
    if (stoppable) queries.updateCancelScheduledTask.runSync(db.sql, { id })
    const pending = queries.getUnfinishedOccurrenceIdByTask.runSync(db.sql, { taskId: id })
    return {
      status: stoppable ? 'cancelled' : row.state,
      inFlight: pending?.id,
      tooLateForCurrent: pending !== null,
    }
  })
}

/** Update an active or paused reservation (pause, resume, or revise instruction/schedule/mode). */
export function updateReservation(
  db: LocalDb,
  id: string,
  patch: {
    action?: 'pause' | 'resume' | 'edit'
    instruction?: string
    rule?: ScheduleSpec
    nextDue?: number | null
    sessionMode?: 'resume' | 'new'
    followupHop?: number
  },
) {
  return db.transactionSync(() => {
    const raw = queries.getScheduledTaskById.runSync(db.sql, { id })
    if (raw === null) return { status: 'not_found' as const }
    const row = parseScheduledTask(raw)
    if (row.state !== 'active' && row.state !== 'paused') {
      return { status: row.state, updated: false }
    }
    let nextState: ScheduledTask['state'] = row.state
    if (patch.action === 'pause') nextState = 'paused'
    if (patch.action === 'resume') nextState = 'active'
    if (row.category === 'followup' && row.state === 'paused' && nextState === 'active') {
      const followups = queries.getActiveFollowupTasksCount.runSync(db.sql).value
      if (followups >= MAX_ACTIVE_FOLLOWUPS) {
        throw new Error(
          `schedule_followup_quota: maximum ${MAX_ACTIVE_FOLLOWUPS} active follow-up timers`,
        )
      }
    }
    const updated = queries.updateScheduledTask.runSync(db.sql, {
      id,
      state: nextState,
      instruction: patch.instruction ?? row.instruction,
      ruleJson: JSON.stringify(patch.rule ?? row.rule),
      nextDue: patch.nextDue === undefined ? row.nextDue : patch.nextDue,
      cursor: patch.rule === undefined ? row.cursor : null,
      sessionMode: patch.sessionMode ?? row.sessionMode,
      followupHop: patch.followupHop ?? row.followupHop,
    })
    if (updated === null) throw new Error(`Scheduled task ${id} missing during update`)
    return { status: 'updated' as const, task: parseScheduledTask(updated) }
  })
}

/** Page stable UUID ordering, including the latest retained execution receipt. */
export function listReservations(db: LocalDb, filter?: ScheduledTask['state'], cursor?: string) {
  const rows = queries.listScheduledTasks
    .runSync(db.sql, {
      state: filter ?? null,
      cursor: cursor ?? null,
    })
    .map(parseScheduledTask)
  return {
    tasks: rows.slice(0, 50).map((row) => {
      const latestRaw = queries.getLatestOccurrenceByTask.runSync(db.sql, { taskId: row.id })
      return {
        taskId: row.id,
        schedule: row.rule,
        instruction: row.instruction,
        category: row.category,
        followupHop: row.followupHop,
        sessionMode: row.sessionMode,
        state: row.state,
        nextDue: row.nextDue,
        latest: latestRaw === null ? undefined : parseScheduledOccurrence(latestRaw),
      }
    }),
    nextCursor: rows.length > 50 ? rows[49]?.id : undefined,
  }
}

/** At most ten eligible definitions; unfinished occurrences block only their own parent. */
export function dueReservations(db: LocalDb, now: number): ScheduledTask[] {
  return queries.listDueScheduledTasks.runSync(db.sql, { now }).map(parseScheduledTask)
}

/** Commit the chosen nominal time, coalesced range, replay ID and next cursor as one unit. */
export function claimOccurrence(
  db: LocalDb,
  task: ScheduledTask,
  at: number,
  next: number | undefined,
  now: number,
): ScheduledOccurrence {
  return db.transactionSync(() => {
    const raw = queries.getScheduledTaskById.runSync(db.sql, { id: task.id })
    const current = raw === null ? undefined : parseScheduledTask(raw)
    if (!current || current.state !== 'active' || current.nextDue !== task.nextDue)
      throw new Error('schedule_claim_changed')
    if (queries.getUnfinishedOccurrenceIdByTask.runSync(db.sql, { taskId: task.id }) !== null)
      throw new Error('schedule_already_running')
    const result = parseScheduledOccurrence(
      queries.insertScheduledOccurrence.runSync(db.sql, {
        id: `scheduled-${task.id}-${at}`,
        taskId: task.id,
        nominalAt: at,
        coalescedFrom: task.nextDue ?? at,
        retryAt: now,
      }),
    )
    queries.updateAdvanceScheduledTaskCursor.runSync(db.sql, {
      id: task.id,
      cursor: at,
      nextDue: next ?? null,
    })
    return result
  })
}

/** Unresolved receipts, optionally restricted to attempts due now. */
export function pendingOccurrences(
  db: LocalDb,
  now?: number,
): { occurrence: ScheduledOccurrence; task: ScheduledTask }[] {
  return queries.listPendingOccurrences
    .runSync(db.sql, { now: now === undefined ? null : now })
    .map((row) => ({
      occurrence: parseScheduledOccurrence({
        id: row.occId,
        taskId: row.occTaskId,
        nominalAt: row.occNominalAt,
        coalescedFrom: row.occCoalescedFrom,
        state: row.occState,
        submissionId: row.occSubmissionId,
        admissionStarted: row.occAdmissionStarted,
        retryAt: row.occRetryAt,
        attempts: row.occAttempts,
        outcome: row.occOutcome,
        settledAt: row.occSettledAt,
      }),
      task: parseScheduledTask({
        id: row.taskId,
        sourceTask: row.taskSourceTask,
        sourceEntry: row.taskSourceEntry,
        arguments: row.taskArguments,
        instruction: row.taskInstruction,
        ruleJson: row.taskRuleJson,
        category: row.taskCategory,
        followupHop: row.taskFollowupHop,
        sessionMode: row.taskSessionMode,
        state: row.taskState,
        nextDue: row.taskNextDue,
        cursor: row.taskCursor,
        createdAt: row.taskCreatedAt,
      }),
    }))
}

/** Persist uncertainty before crossing the Pi admission boundary; never infer rejection later. */
export function markAdmissionStarted(db: LocalDb, id: string): void {
  queries.updateMarkOccurrenceAdmissionStarted.runSync(db.sql, { id })
}

/** Save acceptance independently of execution success. */
export function recordAccepted(db: LocalDb, id: string, submissionId: number, now: number): void {
  queries.updateAcceptOccurrence.runSync(db.sql, { id, submissionId, retryAt: now + 60_000 })
}

/**
 * Settle a receipt and complete an exhausted active definition, never revive a cancelled one.
 * Successful scheduled runs finish silently unless the agent explicitly emits via `send_outbox`.
 */
export function settleOccurrence(
  db: LocalDb,
  occurrence: ScheduledOccurrence,
  outcome: string,
  now: number,
  failed = false,
): void {
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isSafeInteger(now + EXTENSION_RETENTION_MS)
  ) {
    throw new TypeError('Invalid notification timestamp')
  }
  db.transactionSync(() => {
    const settled = queries.updateSettleOccurrence.runSync(db.sql, {
      id: occurrence.id,
      state: failed ? 'failed' : 'settled',
      outcome,
      settledAt: now,
    })
    // Terminal rows and deleted receipts cannot recreate an expired notification on replay.
    if (settled === null) return
    const completion =
      failed || outcome === 'unanswered:model_error' || outcome === 'unanswered:faulted'
        ? 'failed'
        : outcome === 'done'
          ? 'succeeded'
          : outcome === 'unanswered:aborted'
            ? 'cancelled'
            : 'unanswered'
    if (completion !== 'succeeded') {
      insertNotificationRow(
        db,
        {
          source: 'schedule',
          sourceId: occurrence.id,
          outcome: completion,
          summary:
            completion === 'cancelled'
              ? 'Scheduled execution was cancelled.'
              : completion === 'failed'
                ? 'Scheduled execution failed.'
                : 'Scheduled execution ended without an answer.',
          artifactIds: [],
        },
        now,
      )
    }
    queries.updateFinishScheduledTask.runSync(db.sql, {
      id: settled.taskId,
      state: failed ? 'failed' : 'completed',
      failed: failed ? 1 : 0,
    })
  })
}

/** Persist domain backoff, distinct from the shared alarm's wake retry. */
export function retryOccurrence(db: LocalDb, occurrence: ScheduledOccurrence, now: number): void {
  queries.updateRetryOccurrence.runSync(db.sql, {
    id: occurrence.id,
    attempts: occurrence.attempts + 1,
    retryAt: now + Math.min(3_600_000, 60_000 * 2 ** Math.min(occurrence.attempts, 6)),
  })
}

/** Postpone a dispatching occurrence without incrementing attempts (e.g. waiting for idle before reset). */
export function deferOccurrence(
  db: LocalDb,
  occurrence: ScheduledOccurrence,
  retryAt: number,
): void {
  queries.updateDeferOccurrence.runSync(db.sql, { id: occurrence.id, retryAt })
}

/** Select actionable deadlines; blocked definitions use receipt polling, not past-due spinning. */
export function nextScheduleWake(db: LocalDb): number | undefined {
  const pending = queries.getNextPendingOccurrenceRetry.runSync(db.sql)?.at
  const next = queries.getNextActiveTaskDue.runSync(db.sql)?.at
  const times = [pending, next].filter((at): at is number => at !== undefined && at !== null)
  return times.length ? Math.min(...times) : undefined
}

/** Retain replay tombstones; only settled occurrence details older than thirty days are removed. */
export function retainScheduledReceipts(db: LocalDb, now: number): void {
  queries.deleteRetainScheduledOccurrences.runSync(db.sql, { before: now - EXTENSION_RETENTION_MS })
}
