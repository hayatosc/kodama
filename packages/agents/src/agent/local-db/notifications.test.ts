/** Completion deduplication and transaction boundaries in real object SQLite. @module */
import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { notifications } from '../../../drizzle/durable-object/schema.ts'
import { EXTENSION_RETENTION_MS } from '../../extensions.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import { openLocalDb } from './local.ts'
import { recordNotification } from './notifications.ts'

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

describe('recordNotification', () => {
  it('survives reopening and does not change content or acknowledgement on replay', async () => {
    await runInDurableObject(env.AGENTS.getByName(uuidv7()), async (_instance, state) => {
      const db = await openLocalDb(state.storage)
      const first = recordNotification(db, completion(), 1000)
      expect(first).toMatchObject({ ...notice, createdAt: 1000, readAt: null })
      expect(first?.expiresAt).toBe(1000 + EXTENSION_RETENTION_MS)
      db.update(notifications).set({ readAt: 2000 }).run()
      const reopened = await openLocalDb(state.storage)
      expect(
        recordNotification(reopened, { ...completion(), summary: 'Retry' }, 3000),
      ).toBeUndefined()
      expect(reopened.select().from(notifications).all()).toEqual([{ ...first, readAt: 2000 }])
    })
  })

  it('distinguishes schedule and contact sources and uses an increasing sequence', async () => {
    await runInDurableObject(env.AGENTS.getByName(uuidv7()), async (_instance, state) => {
      const db = await openLocalDb(state.storage)
      const first = recordNotification(db, completion(), 1000)
      const second = recordNotification(db, { ...completion(), source: 'schedule' }, 1000)
      expect(first?.seq).toBe(1)
      expect(second?.seq).toBe(2)
      db.delete(notifications).where(eq(notifications.seq, 2)).run()
      const third = recordNotification(db, { ...completion(), sourceId: 'contact-2' }, 1000)
      expect(third?.seq).toBe(3)
    })
  })

  it('rolls back with its producer transaction and can be retried', async () => {
    await runInDurableObject(env.AGENTS.getByName(uuidv7()), async (_instance, state) => {
      const db = await openLocalDb(state.storage)
      expect(() =>
        db.transaction((tx) => {
          recordNotification(tx, completion(), 1000)
          throw new Error('Producer failed')
        }),
      ).toThrow('Producer failed')
      expect(db.select().from(notifications).all()).toEqual([])
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
      expect(db.select().from(notifications).all()).toEqual([])
      expect(
        recordNotification(db, { ...completion(), summary: 'a'.repeat(2048) }, 1000),
      ).toBeDefined()
    })
  })
})
