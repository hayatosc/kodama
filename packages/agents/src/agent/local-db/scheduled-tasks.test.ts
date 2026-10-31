/** Durable scheduling transitions and replay protection in real SQLite. @module */
import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { uuidv7 } from '../../lib/uuid.ts'
import { openLocalDb } from './local.ts'
import {
  cancelReservation,
  claimOccurrence,
  dueReservations,
  insertReservation,
  listReservations,
  nextScheduleWake,
  pendingOccurrences,
  recordAccepted,
  reservationReplay,
  retainScheduledReceipts,
  settleOccurrence,
} from './scheduled-tasks.ts'
import type { LocalDb } from './local.ts'

function insert(local: LocalDb, sourceTask = crypto.randomUUID()) {
  return insertReservation(
    local,
    {
      sourceTask,
      sourceEntry: 1,
      arguments: '{}',
      instruction: 'Work',
      rule: { kind: 'interval', start: 1000, every: 60_000 },
      nextDue: 1000,
    },
    1,
  )
}

describe('reservation store', () => {
  it('preserves a replay identity and rejects changed arguments', async () => {
    await runInDurableObject(env.AGENTS.getByName(uuidv7()), async (_instance, state) => {
      const local = await openLocalDb(state.storage)
      const task = insert(local, 'tool-1')
      expect(reservationReplay(local, 'tool-1', '{}')?.id).toBe(task.id)
      expect(() => reservationReplay(local, 'tool-1', '{"changed":true}')).toThrow(
        'schedule_replay_mismatch',
      )
    })
  })

  it('claims atomically, blocks overlap, and cancellation cannot resurrect a definition', async () => {
    await runInDurableObject(env.AGENTS.getByName(uuidv7()), async (_instance, state) => {
      const local = await openLocalDb(state.storage)
      const task = insert(local)
      const occurrence = claimOccurrence(local, task, 121_000, 181_000, 122_000)
      expect(occurrence).toMatchObject({
        id: `scheduled-${task.id}-121000`,
        coalescedFrom: 1000,
        state: 'dispatching',
      })
      expect(dueReservations(local, 200_000)).toEqual([])
      expect(nextScheduleWake(local)).toBe(122_000)
      expect(() => claimOccurrence(local, task, 121_000, 181_000, 122_000)).toThrow(
        'schedule_claim_changed',
      )
      expect(cancelReservation(local, task.id)).toMatchObject({
        status: 'cancelled',
        tooLateForCurrent: true,
      })
      recordAccepted(local, occurrence.id, 42, 123_000)
      expect(nextScheduleWake(local)).toBe(183_000)
      settleOccurrence(local, occurrence, 'done', 124_000)
      expect(listReservations(local).tasks[0]).toMatchObject({
        state: 'cancelled',
        nextDue: null,
        latest: { state: 'settled', outcome: 'done' },
      })
      expect(nextScheduleWake(local)).toBeUndefined()
    })
  })

  it('retains cursor and replay tombstone when old occurrence receipts expire', async () => {
    await runInDurableObject(env.AGENTS.getByName(uuidv7()), async (_instance, state) => {
      const local = await openLocalDb(state.storage)
      const task = insert(local, 'tool-retained')
      const occurrence = claimOccurrence(local, task, 1000, 61_000, 1000)
      retainScheduledReceipts(local, 40 * 86_400_000)
      expect(pendingOccurrences(local)).toHaveLength(1)
      settleOccurrence(local, occurrence, 'done', 2000)
      retainScheduledReceipts(local, 40 * 86_400_000)
      expect(listReservations(local).tasks[0]?.latest).toBeUndefined()
      expect(reservationReplay(local, 'tool-retained', '{}')).toMatchObject({
        cursor: 1000,
        nextDue: 61_000,
      })
    })
  })

  it('counts stopped-but-unsettled reservations, enforces quota, and paginates by stable ID', async () => {
    await runInDurableObject(env.AGENTS.getByName(uuidv7()), async (_instance, state) => {
      const local = await openLocalDb(state.storage)
      const first = insert(local)
      const occurrence = claimOccurrence(local, first, 1000, 61_000, 1000)
      cancelReservation(local, first.id)
      for (let i = 1; i < 100; i++) insert(local)
      expect(() => insert(local)).toThrow('schedule_quota')
      const page = listReservations(local)
      const second = listReservations(local, undefined, page.nextCursor)
      expect(page.tasks).toHaveLength(50)
      expect(second.tasks).toHaveLength(50)
      expect(second.nextCursor).toBeUndefined()
      expect(new Set([...page.tasks, ...second.tasks].map((task) => task.taskId)).size).toBe(100)
      settleOccurrence(local, occurrence, 'done', 2000)
      expect(insert(local).state).toBe('active')
    })
  })
})
