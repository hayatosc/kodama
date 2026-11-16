/** Completion deduplication and transaction boundaries in real object SQLite. @module */
import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vite-plus/test'
import { EXTENSION_RETENTION_MS } from '../../extensions.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import deleteAllContactRequests from '../../testing/sql/delete-all-contact-requests.sql'
import deleteNotificationBySeq from '../../testing/sql/delete-notification-by-seq.sql'
import insertContactRequestRaw from '../../testing/sql/insert-contact-request-raw.sql'
import selectAllNotifications from '../../testing/sql/select-all-notifications.sql'
import setNotificationsReadAt from '../../testing/sql/set-notifications-read-at.sql'
import { contactRequest } from './contacts.ts'
import { openLocalDb } from './local.ts'
import {
  dispatchDueOutbox,
  enqueueOutboxNotification,
  listNotifications,
  nextNotificationExpiry,
  nextOutboxWake,
  OUTBOX_PACING_WINDOW_MS,
  readNotification,
  recentOutboxSummaries,
  recordNotification,
  retainNotifications,
} from './notifications.ts'

const notice = {
  source: 'contact',
  sourceId: 'contact-1',
  outcome: 'succeeded',
  summary: 'Work completed',
  artifactIds: ['artifact-1'],
} as const

// Each insert receives an owned mutable array, like decoded RPC data.
function completion() {
  return { ...notice, artifactIds: [...notice.artifactIds] }
}

describe('inbox operations', () => {
  it('paginates descending by exclusive sequence despite concurrent inserts and read changes', async () => {
    await runInDurableObject(env.AGENTS.getByName(uuidv7()), async (_instance, state) => {
      const db = await openLocalDb(state.storage)
      for (let i = 1; i <= 5; i++)
        recordNotification(db, { ...completion(), sourceId: `contact-${i}` }, 1000)
      expect(readNotification(db, 4, 1100)).toBe(true)
      const first = listNotifications(db, { limit: 2, unreadOnly: true }, 1200)
      expect(first.notifications.map((item) => item.seq)).toEqual([5, 3])
      expect(first.nextBefore).toBe(3)
      recordNotification(db, { ...completion(), sourceId: 'new' }, 1300)
      readNotification(db, 3, 1400)
      const second = listNotifications(
        db,
        { limit: 2, unreadOnly: true, before: first.nextBefore },
        1500,
      )
      expect(second.notifications.map((item) => item.seq)).toEqual([2, 1])
      expect(second.nextBefore).toBeUndefined()
      expect(listNotifications(db, {}, 1500).notifications.map((item) => item.seq)).toEqual([
        6, 5, 4, 3, 2, 1,
      ])
      expect(listNotifications(db, { before: 1 }, 1500)).toEqual({ notifications: [] })
      expect(readNotification(db, 3, 1600)).toBe(true)
      expect(selectAllNotifications.runSync(db.sql).find((item) => item.seq === 3)?.readAt).toBe(
        1400,
      )
      expect(readNotification(db, 999, 1600)).toBe(false)
    })
  })

  it('bounds pages, explicitly describes missing or expired results, and retains results on read', async () => {
    await runInDurableObject(env.AGENTS.getByName(uuidv7()), async (_instance, state) => {
      const db = await openLocalDb(state.storage)
      insertContactRequestRaw.runSync(db.sql, {
        id: 'contact-1',
        sourceTask: 'task',
        sourceEntry: 1,
        arguments: '{}',
        targetAgentId: uuidv7(),
        requestId: 'request',
        content: 'Work',
        hop: 1,
        state: 'settled',
        retryAt: 1000,
        result: JSON.stringify({
          outcome: 'succeeded',
          text: 'Answer',
          truncated: false,
          artifactIds: [],
        }),
        createdAt: 1,
        settledAt: 1000,
        expiresAt: 1500,
      })
      recordNotification(db, completion(), 1000)
      expect(listNotifications(db, {}, 1200).notifications[0]?.referenceState).toBe('available')
      expect(readNotification(db, 1, 1250)).toBe(true)
      expect(contactRequest(db, 'contact-1')?.result?.text).toBe('Answer')
      expect(listNotifications(db, {}, 1500).notifications[0]?.referenceState).toBe('expired')
      for (const query of [
        { limit: 0 },
        { limit: 101 },
        { limit: 1.5 },
        { before: 0 },
        { before: Number.MAX_SAFE_INTEGER + 1 },
        { unreadOnly: 'yes' },
        { after: 1 },
      ])
        expect(() => listNotifications(db, query, 1500)).toThrow(TypeError)
      deleteAllContactRequests.runSync(db.sql)
      expect(listNotifications(db, {}, 1600).notifications[0]?.referenceState).toBe('expired')
    })
  })

  it('expires read and unread metadata at the boundary without reusing sequences', async () => {
    await runInDurableObject(env.AGENTS.getByName(uuidv7()), async (_instance, state) => {
      const db = await openLocalDb(state.storage)
      recordNotification(db, completion(), 1000)
      recordNotification(db, { ...completion(), sourceId: 'second' }, 2000)
      readNotification(db, 1, 2000)
      expect(nextNotificationExpiry(db)).toBe(1000 + EXTENSION_RETENTION_MS)
      retainNotifications(db, 999 + EXTENSION_RETENTION_MS)
      expect(selectAllNotifications.runSync(db.sql)).toHaveLength(2)
      expect(readNotification(db, 1, 1000 + EXTENSION_RETENTION_MS)).toBe(false)
      expect(
        listNotifications(db, {}, 1000 + EXTENSION_RETENTION_MS).notifications.map(
          (item) => item.seq,
        ),
      ).toEqual([2])
      retainNotifications(db, 2000 + EXTENSION_RETENTION_MS)
      expect(nextNotificationExpiry(db)).toBeUndefined()
      expect(
        recordNotification(
          db,
          { ...completion(), sourceId: 'third' },
          3000 + EXTENSION_RETENTION_MS,
        )?.seq,
      ).toBe(3)
    })
  })
})

describe('recordNotification', () => {
  it('survives reopening and does not change content or acknowledgement on replay', async () => {
    await runInDurableObject(env.AGENTS.getByName(uuidv7()), async (_instance, state) => {
      const db = await openLocalDb(state.storage)
      const first = recordNotification(db, completion(), 1000)
      if (!first) throw new Error('Missing notification')
      expect(first).toMatchObject({ ...notice, createdAt: 1000, readAt: null })
      expect(first.expiresAt).toBe(1000 + EXTENSION_RETENTION_MS)
      setNotificationsReadAt.runSync(db.sql, { readAt: 2000 })
      const reopened = await openLocalDb(state.storage)
      expect(
        recordNotification(reopened, { ...completion(), summary: 'Retry' }, 3000),
      ).toBeUndefined()
      expect(selectAllNotifications.runSync(reopened.sql)).toEqual([
        { ...first, artifactIds: JSON.stringify(first.artifactIds), readAt: 2000 },
      ])
    })
  })

  it('distinguishes schedule and contact sources and uses an increasing sequence', async () => {
    await runInDurableObject(env.AGENTS.getByName(uuidv7()), async (_instance, state) => {
      const db = await openLocalDb(state.storage)
      const first = recordNotification(db, completion(), 1000)
      const second = recordNotification(db, { ...completion(), source: 'schedule' }, 1000)
      expect(first?.seq).toBe(1)
      expect(second?.seq).toBe(2)
      deleteNotificationBySeq.runSync(db.sql, { seq: 2 })
      const third = recordNotification(db, { ...completion(), sourceId: 'contact-2' }, 1000)
      expect(third?.seq).toBe(3)
    })
  })

  it('rolls back with its producer transaction and can be retried', async () => {
    await runInDurableObject(env.AGENTS.getByName(uuidv7()), async (_instance, state) => {
      const db = await openLocalDb(state.storage)
      expect(() =>
        state.storage.transactionSync(() => {
          recordNotification(db, completion(), 1000)
          throw new Error('Producer failed')
        }),
      ).toThrow('Producer failed')
      expect(selectAllNotifications.runSync(db.sql)).toEqual([])
      expect(recordNotification(db, completion(), 1000)).toBeDefined()
    })
  })

  it('rejects oversized UTF-8 summaries and invalid retention timestamps before writing', async () => {
    await runInDurableObject(env.AGENTS.getByName(uuidv7()), async (_instance, state) => {
      const db = await openLocalDb(state.storage)
      expect(() =>
        recordNotification(db, { ...completion(), summary: '語'.repeat(683) }, 1000),
      ).toThrow('Notification summary exceeds byte limit')
      for (const now of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER])
        expect(() => recordNotification(db, completion(), now)).toThrow(
          'Invalid notification timestamp',
        )
      expect(() => recordNotification(db, { ...completion(), sourceId: '' }, 1000)).toThrow(
        'Invalid notification source ID',
      )
      expect(() => recordNotification(db, { ...completion(), artifactIds: [''] }, 1000)).toThrow(
        'Invalid notification artifact references',
      )
      expect(selectAllNotifications.runSync(db.sql)).toEqual([])
      expect(
        recordNotification(db, { ...completion(), summary: 'a'.repeat(2048) }, 1000),
      ).toBeDefined()
    })
  })
})

describe('outbox pacing and coalescing', () => {
  it('dispatches the first alert immediately, paces bursts within cooldown, and coalesces due alerts', async () => {
    await runInDurableObject(env.AGENTS.getByName(uuidv7()), async (_instance, state) => {
      const db = await openLocalDb(state.storage)
      const first = enqueueOutboxNotification(
        db,
        {
          sourceId: 'outbox-1',
          summary: 'Build failed on main',
          details: 'Check step timed out',
          artifactIds: ['a1'],
          urgency: 'normal',
        },
        10_000,
      )
      expect(first?.deliveryState).toBe('dispatched')
      expect(nextOutboxWake(db)).toBeUndefined()

      const second = enqueueOutboxNotification(
        db,
        {
          sourceId: 'outbox-2',
          summary: 'Disk above 85%',
          details: 'Node A',
          artifactIds: ['a2'],
          urgency: 'normal',
        },
        20_000,
      )
      const third = enqueueOutboxNotification(
        db,
        {
          sourceId: 'outbox-3',
          summary: 'Disk above 90%',
          details: 'Node B',
          artifactIds: ['a3', 'a2'],
          urgency: 'normal',
        },
        30_000,
      )
      expect(second?.deliveryState).toBe('pending')
      expect(third?.deliveryState).toBe('pending')
      expect(nextOutboxWake(db)).toBe(10_000 + OUTBOX_PACING_WINDOW_MS)
      expect(listNotifications(db, {}, 35_000).notifications.map((n) => n.sourceId)).toEqual([
        'outbox-1',
      ])

      const dueAt = 10_000 + OUTBOX_PACING_WINDOW_MS
      expect(dispatchDueOutbox(db, dueAt)).toBe(2)
      expect(nextOutboxWake(db)).toBeUndefined()
      const listed = listNotifications(db, {}, dueAt).notifications
      expect(listed).toHaveLength(2)
      expect(listed[0]).toMatchObject({
        source: 'outbox',
        sourceId: 'outbox-3',
        summary: 'Disk above 85%\n• Disk above 90%',
        details: 'Node A\n\n---\n\nNode B',
        artifactIds: ['a2', 'a3'],
        referenceState: 'available',
      })
      const secondRow = selectAllNotifications
        .runSync(db.sql)
        .find((item) => item.sourceId === 'outbox-2')
      expect(secondRow?.deliveryState).toBe('suppressed')
      expect(recentOutboxSummaries(db, 5).map((item) => item.summary)).toEqual([
        'Build failed on main',
        'Disk above 85%\n• Disk above 90%',
      ])
    })
  })

  it('flushes pending alerts immediately when urgency is immediate', async () => {
    await runInDurableObject(env.AGENTS.getByName(uuidv7()), async (_instance, state) => {
      const db = await openLocalDb(state.storage)
      enqueueOutboxNotification(
        db,
        { sourceId: 'o1', summary: 'First', artifactIds: [], urgency: 'normal' },
        10_000,
      )
      enqueueOutboxNotification(
        db,
        { sourceId: 'o2', summary: 'Queued', artifactIds: [], urgency: 'normal' },
        15_000,
      )
      const urgent = enqueueOutboxNotification(
        db,
        { sourceId: 'o3', summary: 'Critical outage', artifactIds: [], urgency: 'immediate' },
        20_000,
      )
      expect(urgent?.deliveryState).toBe('dispatched')
      expect(nextOutboxWake(db)).toBeUndefined()
      expect(listNotifications(db, {}, 20_000).notifications.map((n) => n.sourceId)).toEqual([
        'o3',
        'o2',
        'o1',
      ])
    })
  })

  it('measures cooldown from dispatch time across consecutive pacing windows', async () => {
    await runInDurableObject(env.AGENTS.getByName(uuidv7()), async (_instance, state) => {
      const db = await openLocalDb(state.storage)
      enqueueOutboxNotification(
        db,
        { sourceId: 'win-1', summary: 'Window 1', artifactIds: [], urgency: 'normal' },
        10_000,
      )
      enqueueOutboxNotification(
        db,
        { sourceId: 'win-2', summary: 'Window 2', artifactIds: [], urgency: 'normal' },
        20_000,
      )
      const secondDispatchAt = 10_000 + OUTBOX_PACING_WINDOW_MS
      expect(dispatchDueOutbox(db, secondDispatchAt)).toBe(1)

      const third = enqueueOutboxNotification(
        db,
        { sourceId: 'win-3', summary: 'Window 3', artifactIds: [], urgency: 'normal' },
        secondDispatchAt + 10_000,
      )
      expect(third?.deliveryState).toBe('pending')
      expect(third?.deliverAfter).toBe(secondDispatchAt + OUTBOX_PACING_WINDOW_MS)
      expect(nextOutboxWake(db)).toBe(secondDispatchAt + OUTBOX_PACING_WINDOW_MS)
    })
  })
})
