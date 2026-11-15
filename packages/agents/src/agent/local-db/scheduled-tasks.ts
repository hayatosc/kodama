/** Local reservation persistence and atomic cursor transitions; no model or network operations.
 * @see docs/agents.md — Scheduled tasks
 * @module
 */
import { and, count, eq, gt, inArray, isNull, lte, ne, notExists, or, desc } from 'drizzle-orm'
import {
  scheduledTasks as tasks,
  scheduledTaskOccurrences as occurrences,
} from '../../../drizzle/durable-object/schema.ts'
import type { LocalDb } from './local.ts'
import { recordNotification } from './notifications.ts'
import { EXTENSION_RETENTION_MS } from '../../extensions.ts'
import type { ScheduleSpec } from '../schedule-spec.ts'
import { uuidv7 } from '../../lib/uuid.ts'

/** Immutable rule and its durable progress. */
export type ScheduledTask = typeof tasks.$inferSelect
/** A materialized, uniquely addressed execution. */
export type ScheduledOccurrence = typeof occurrences.$inferSelect

/** Maximum autonomous follow-up chain depth without owner intervention. */
export const MAX_FOLLOWUP_HOPS = 5
/** Maximum concurrently active follow-up reservations per agent. */
export const MAX_ACTIVE_FOLLOWUPS = 10

const unfinished = inArray(occurrences.state, ['dispatching', 'submitted'])

/** Read a replay before validating temporal limits or generating a new default anchor. */
export function reservationReplay(
  db: LocalDb,
  sourceTask: string,
  args: string,
): ScheduledTask | undefined {
  const row = db.select().from(tasks).where(eq(tasks.sourceTask, sourceTask)).get()
  if (row && row.arguments !== args) throw new TypeError('schedule_replay_mismatch')
  return row
}

/** Read one reservation by ID, if it exists. */
export function getReservation(db: LocalDb, id: string): ScheduledTask | undefined {
  return db.select().from(tasks).where(eq(tasks.id, id)).get()
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
  return db.transaction((tx) => {
    const open =
      tx
        .select({ value: count() })
        .from(tasks)
        .where(
          or(
            eq(tasks.state, 'active'),
            eq(tasks.state, 'paused'),
            inArray(
              tasks.id,
              tx.select({ id: occurrences.taskId }).from(occurrences).where(unfinished),
            ),
          ),
        )
        .get()?.value ?? 0
    if (open >= 100) throw new Error('schedule_quota: maximum 100 active or unsettled reservations')
    if (input.category === 'followup') {
      const followups =
        tx
          .select({ value: count() })
          .from(tasks)
          .where(and(eq(tasks.category, 'followup'), eq(tasks.state, 'active')))
          .get()?.value ?? 0
      if (followups >= MAX_ACTIVE_FOLLOWUPS) {
        throw new Error(
          `schedule_followup_quota: maximum ${MAX_ACTIVE_FOLLOWUPS} active follow-up timers`,
        )
      }
    }
    return tx
      .insert(tasks)
      .values({ ...input, id: uuidv7(), state: 'active', createdAt: now })
      .returning()
      .get()
  })
}

/** Stop future materialization without aborting a claimed or admitted execution. */
export function cancelReservation(db: LocalDb, id: string) {
  return db.transaction((tx) => {
    const row = tx.select().from(tasks).where(eq(tasks.id, id)).get()
    if (!row) return { status: 'not_found' }
    const stoppable = row.state === 'active' || row.state === 'paused'
    if (stoppable)
      tx.update(tasks).set({ state: 'cancelled', nextDue: null }).where(eq(tasks.id, id)).run()
    const pending = tx
      .select({ id: occurrences.id })
      .from(occurrences)
      .where(and(eq(occurrences.taskId, id), unfinished))
      .get()
    return {
      status: stoppable ? 'cancelled' : row.state,
      inFlight: pending?.id,
      tooLateForCurrent: pending !== undefined,
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
  return db.transaction((tx) => {
    const row = tx.select().from(tasks).where(eq(tasks.id, id)).get()
    if (!row) return { status: 'not_found' as const }
    if (row.state !== 'active' && row.state !== 'paused') {
      return { status: row.state, updated: false }
    }
    let nextState: ScheduledTask['state'] = row.state
    if (patch.action === 'pause') nextState = 'paused'
    if (patch.action === 'resume') nextState = 'active'
    if (row.category === 'followup' && row.state === 'paused' && nextState === 'active') {
      const followups =
        tx
          .select({ value: count() })
          .from(tasks)
          .where(and(eq(tasks.category, 'followup'), eq(tasks.state, 'active')))
          .get()?.value ?? 0
      if (followups >= MAX_ACTIVE_FOLLOWUPS) {
        throw new Error(
          `schedule_followup_quota: maximum ${MAX_ACTIVE_FOLLOWUPS} active follow-up timers`,
        )
      }
    }
    const updates: Partial<typeof tasks.$inferInsert> = {
      state: nextState,
      ...(patch.instruction === undefined ? {} : { instruction: patch.instruction }),
      ...(patch.rule === undefined ? {} : { rule: patch.rule, cursor: null }),
      ...(patch.nextDue === undefined ? {} : { nextDue: patch.nextDue }),
      ...(patch.sessionMode === undefined ? {} : { sessionMode: patch.sessionMode }),
      ...(patch.followupHop === undefined ? {} : { followupHop: patch.followupHop }),
    }
    const updated = tx.update(tasks).set(updates).where(eq(tasks.id, id)).returning().get()
    return { status: 'updated' as const, task: updated }
  })
}

/** Page stable UUID ordering, including the latest retained execution receipt. */
export function listReservations(db: LocalDb, filter?: ScheduledTask['state'], cursor?: string) {
  const rows = db
    .select()
    .from(tasks)
    .where(
      and(filter ? eq(tasks.state, filter) : undefined, cursor ? gt(tasks.id, cursor) : undefined),
    )
    .orderBy(tasks.id)
    .limit(51)
    .all()
  return {
    tasks: rows.slice(0, 50).map((row) => ({
      taskId: row.id,
      schedule: row.rule,
      instruction: row.instruction,
      category: row.category,
      followupHop: row.followupHop,
      sessionMode: row.sessionMode,
      state: row.state,
      nextDue: row.nextDue,
      latest: db
        .select()
        .from(occurrences)
        .where(eq(occurrences.taskId, row.id))
        .orderBy(desc(occurrences.nominalAt))
        .limit(1)
        .get(),
    })),
    nextCursor: rows.length > 50 ? rows[49]?.id : undefined,
  }
}

/** At most ten eligible definitions; unfinished occurrences block only their own parent. */
export function dueReservations(db: LocalDb, now: number): ScheduledTask[] {
  return db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.state, 'active'),
        lte(tasks.nextDue, now),
        notExists(
          db
            .select({ id: occurrences.id })
            .from(occurrences)
            .where(and(eq(occurrences.taskId, tasks.id), unfinished)),
        ),
      ),
    )
    .orderBy(tasks.nextDue, tasks.id)
    .limit(10)
    .all()
}

/** Commit the chosen nominal time, coalesced range, replay ID and next cursor as one unit. */
export function claimOccurrence(
  db: LocalDb,
  task: ScheduledTask,
  at: number,
  next: number | undefined,
  now: number,
): ScheduledOccurrence {
  return db.transaction((tx) => {
    const current = tx.select().from(tasks).where(eq(tasks.id, task.id)).get()
    if (!current || current.state !== 'active' || current.nextDue !== task.nextDue)
      throw new Error('schedule_claim_changed')
    if (
      tx
        .select()
        .from(occurrences)
        .where(and(eq(occurrences.taskId, task.id), unfinished))
        .get()
    )
      throw new Error('schedule_already_running')
    const result = tx
      .insert(occurrences)
      .values({
        id: `scheduled-${task.id}-${at}`,
        taskId: task.id,
        nominalAt: at,
        coalescedFrom: task.nextDue ?? at,
        state: 'dispatching',
        retryAt: now,
      })
      .returning()
      .get()
    tx.update(tasks)
      .set({ cursor: at, nextDue: next ?? null })
      .where(eq(tasks.id, task.id))
      .run()
    return result
  })
}

/** Unresolved receipts, optionally restricted to attempts due now. */
export function pendingOccurrences(db: LocalDb, now?: number) {
  return db
    .select({ occurrence: occurrences, task: tasks })
    .from(occurrences)
    .innerJoin(tasks, eq(tasks.id, occurrences.taskId))
    .where(and(unfinished, now === undefined ? undefined : lte(occurrences.retryAt, now)))
    .orderBy(occurrences.retryAt, occurrences.id)
    .limit(100)
    .all()
}

/** Persist uncertainty before crossing the Pi admission boundary; never infer rejection later. */
export function markAdmissionStarted(db: LocalDb, id: string): void {
  db.update(occurrences)
    .set({ admissionStarted: true })
    .where(and(eq(occurrences.id, id), unfinished))
    .run()
}

/** Save acceptance independently of execution success. */
export function recordAccepted(db: LocalDb, id: string, submissionId: number, now: number): void {
  db.update(occurrences)
    .set({ state: 'submitted', submissionId, retryAt: now + 60_000 })
    .where(and(eq(occurrences.id, id), unfinished))
    .run()
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
  db.transaction((tx) => {
    const settled = tx
      .update(occurrences)
      .set({ state: failed ? 'failed' : 'settled', outcome, settledAt: now })
      .where(and(eq(occurrences.id, occurrence.id), unfinished))
      .returning({ taskId: occurrences.taskId })
      .get()
    // Terminal rows and deleted receipts cannot recreate an expired notification on replay.
    if (!settled) return
    const completion =
      failed || outcome === 'unanswered:model_error' || outcome === 'unanswered:faulted'
        ? 'failed'
        : outcome === 'done'
          ? 'succeeded'
          : outcome === 'unanswered:aborted'
            ? 'cancelled'
            : 'unanswered'
    if (completion !== 'succeeded') {
      recordNotification(
        tx,
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
    tx.update(tasks)
      .set({ state: failed ? 'failed' : 'completed', nextDue: null })
      .where(
        and(
          eq(tasks.id, settled.taskId),
          eq(tasks.state, 'active'),
          failed ? undefined : isNull(tasks.nextDue),
        ),
      )
      .run()
  })
}

/** Persist domain backoff, distinct from the shared alarm's wake retry. */
export function retryOccurrence(db: LocalDb, occurrence: ScheduledOccurrence, now: number): void {
  db.update(occurrences)
    .set({
      attempts: occurrence.attempts + 1,
      retryAt: now + Math.min(3_600_000, 60_000 * 2 ** Math.min(occurrence.attempts, 6)),
    })
    .where(and(eq(occurrences.id, occurrence.id), unfinished))
    .run()
}

/** Postpone a dispatching occurrence without incrementing attempts (e.g. waiting for idle before reset). */
export function deferOccurrence(
  db: LocalDb,
  occurrence: ScheduledOccurrence,
  retryAt: number,
): void {
  db.update(occurrences)
    .set({ retryAt })
    .where(and(eq(occurrences.id, occurrence.id), eq(occurrences.state, 'dispatching')))
    .run()
}

/** Select actionable deadlines; blocked definitions use receipt polling, not past-due spinning. */
export function nextScheduleWake(db: LocalDb): number | undefined {
  const pending = db
    .select({ at: occurrences.retryAt })
    .from(occurrences)
    .where(unfinished)
    .orderBy(occurrences.retryAt)
    .limit(1)
    .get()?.at
  const next = db
    .select({ at: tasks.nextDue })
    .from(tasks)
    .where(
      and(
        eq(tasks.state, 'active'),
        notExists(
          db
            .select({ id: occurrences.id })
            .from(occurrences)
            .where(and(eq(occurrences.taskId, tasks.id), unfinished)),
        ),
      ),
    )
    .orderBy(tasks.nextDue)
    .limit(1)
    .get()?.at
  const times = [pending, next].filter((at): at is number => at !== undefined && at !== null)
  return times.length ? Math.min(...times) : undefined
}

/** Retain replay tombstones; only settled occurrence details older than thirty days are removed. */
export function retainScheduledReceipts(db: LocalDb, now: number): void {
  db.delete(occurrences)
    .where(
      and(
        ne(occurrences.state, 'dispatching'),
        ne(occurrences.state, 'submitted'),
        lte(occurrences.settledAt, now - EXTENSION_RETENTION_MS),
      ),
    )
    .run()
}
