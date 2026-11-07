/** Durable contact progress, first-terminal completion and explicit result retention. @module */
import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vite-plus/test'
import { contactRequests, notifications } from '../../../drizzle/durable-object/schema.ts'
import { EXTENSION_RETENTION_MS, MAX_CONTACT_RESULT_BYTES } from '../../extensions.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import { boundedContactResult } from '../contact.ts'
import { openLocalDb } from './local.ts'
import {
  acceptContact,
  acknowledgeReceipt,
  contactReceipt,
  contactReplay,
  contactRequest,
  contactView,
  deferContact,
  finishContactAcknowledgement,
  listContacts,
  reserveContact,
  reserveReceipt,
  retainContacts,
  retryContact,
  settleContact,
  updateReceipt,
} from './contacts.ts'

const input = () => ({
  sourceTask: uuidv7(),
  sourceEntry: 1,
  arguments: '{"message":"question"}',
  targetAgentId: uuidv7(),
  content: 'question',
  hop: 1,
})
const answer = () => boundedContactResult('succeeded', 'A retained answer')

describe('sender contact store', () => {
  it('keeps stable replay identity, refuses changed arguments and never confuses admission with completion', async () => {
    await runInDurableObject(env.AGENTS.getByName(uuidv7()), async (_, state) => {
      const db = await openLocalDb(state.storage)
      const value = input()
      const first = reserveContact(db, value, 1000)
      expect(contactReplay(db, value.sourceTask, value.arguments)?.id).toBe(first.id)
      expect(() => contactReplay(db, value.sourceTask, '{}')).toThrow('contact_replay_mismatch')
      acceptContact(db, first.id, 42, 2000)
      expect(contactView(contactRequest(db, first.id) ?? first, true, 2000)).toMatchObject({
        contactId: first.id,
        status: 'pending',
        submissionId: 42,
      })
      expect(db.select().from(notifications).all()).toEqual([])
      expect(listContacts(db).contacts).toHaveLength(1)
    })
  })

  it('defers pending delivery and unacknowledged results without shortening backoff or resurrecting an ack', async () => {
    await runInDurableObject(env.AGENTS.getByName(uuidv7()), async (_, state) => {
      const db = await openLocalDb(state.storage)
      const row = reserveContact(db, input(), 1000)
      deferContact(db, row.id, 2000)
      expect(contactRequest(db, row.id)?.retryAt).toBe(62_000)
      retryContact(db, row.id, 3000)
      retryContact(db, row.id, 4000)
      deferContact(db, row.id, 5000)
      expect(contactRequest(db, row.id)?.retryAt).toBe(124_000)
      settleContact(db, row.id, answer(), 6000)
      deferContact(db, row.id, 7000)
      expect(contactRequest(db, row.id)?.retryAt).toBe(67_000)
      finishContactAcknowledgement(db, row.id)
      deferContact(db, row.id, 8000)
      retryContact(db, row.id, 9000)
      expect(contactRequest(db, row.id)?.retryAt).toBe(0)
    })
  })

  it('atomically records only the first terminal result and notification, even after notification deletion', async () => {
    await runInDurableObject(env.AGENTS.getByName(uuidv7()), async (_, state) => {
      const db = await openLocalDb(state.storage)
      const first = reserveContact(db, input(), 1000)
      // Invalid notification timestamps fail after the producer update, proving transaction rollback.
      expect(() => settleContact(db, first.id, answer(), -1)).toThrow(
        'Invalid notification timestamp',
      )
      expect(contactRequest(db, first.id)?.settledAt).toBeNull()
      expect(db.select().from(notifications).all()).toEqual([])
      settleContact(db, first.id, answer(), 2000)
      settleContact(db, first.id, boundedContactResult('failed', 'Later failure'), 3000)
      expect(contactRequest(db, first.id)?.result).toEqual(answer())
      expect(db.select().from(notifications).all()).toMatchObject([
        { source: 'contact', sourceId: first.id, outcome: 'succeeded', createdAt: 2000 },
      ])
      db.delete(notifications).run()
      settleContact(db, first.id, answer(), 4000)
      expect(db.select().from(notifications).all()).toEqual([])
      expect(
        contactReplay(await openLocalDb(state.storage), first.sourceTask, first.arguments)?.id,
      ).toBe(first.id)
    })
  })

  it('does not expire pending or unacknowledged work, but makes retained result expiry explicit', async () => {
    await runInDurableObject(env.AGENTS.getByName(uuidv7()), async (_, state) => {
      const db = await openLocalDb(state.storage)
      const pending = reserveContact(db, input(), 1000)
      const terminal = reserveContact(db, input(), 1000)
      settleContact(db, terminal.id, answer(), 2000)
      const expiredAt = 2000 + EXTENSION_RETENTION_MS
      retainContacts(db, expiredAt)
      expect(contactRequest(db, terminal.id)?.result).toEqual(answer())
      expect(contactRequest(db, pending.id)?.settledAt).toBeNull()
      finishContactAcknowledgement(db, terminal.id)
      retainContacts(db, expiredAt)
      const retained = contactRequest(db, terminal.id)
      if (!retained) throw new Error('Missing tombstone')
      expect(retained.result).toBeNull()
      expect(contactView(retained, true, expiredAt)).toMatchObject({
        status: 'expired',
        expired: true,
      })
      settleContact(db, terminal.id, answer(), expiredAt + 1)
      expect(contactRequest(db, terminal.id)?.result).toBeNull()
      expect(db.select().from(notifications).all()).toHaveLength(1)
      retryContact(db, pending.id, expiredAt)
      expect(contactRequest(db, pending.id)?.retryAt).toBe(expiredAt + 60_000)
    })
  })

  it('bounds pending outbox work and paginates without exposing request content', async () => {
    await runInDurableObject(env.AGENTS.getByName(uuidv7()), async (_, state) => {
      const db = await openLocalDb(state.storage)
      for (let index = 0; index < 100; index++) reserveContact(db, input(), 1000)
      expect(() => reserveContact(db, input(), 1000)).toThrow('contact_quota')
      const first = listContacts(db)
      const second = listContacts(db, first.nextCursor)
      expect(first.contacts).toHaveLength(50)
      expect(second.contacts).toHaveLength(50)
      expect(second.nextCursor).toBeUndefined()
      expect(JSON.stringify(first)).not.toContain('question')
      const id = first.contacts[0]?.contactId
      if (!id) throw new Error('Missing contact')
      db.update(contactRequests)
        .set({ state: 'failed', settledAt: 1 })
        .where(eq(contactRequests.id, id))
        .run()
      expect(reserveContact(db, input(), 1000).state).toBe('dispatching')
    })
  })
})

describe('receiver receipts and answer bounds', () => {
  it('keeps the pruning fence and unacknowledged answer across reopening and applies acknowledgement once', async () => {
    await runInDurableObject(env.AGENTS.getByName(uuidv7()), async (_, state) => {
      const db = await openLocalDb(state.storage)
      const sender = uuidv7()
      const receipt = reserveReceipt(db, sender, 'stable-request', 1000)
      expect(receipt.submissionId).toBe(0)
      expect(reserveReceipt(db, sender, 'stable-request', 2000)).toEqual(receipt)
      updateReceipt(db, receipt, 42, answer(), 3000)
      updateReceipt(db, receipt, 43, boundedContactResult('failed', 'wrong'), 4000)
      retainContacts(db, 10 * EXTENSION_RETENTION_MS)
      const reopened = await openLocalDb(state.storage)
      expect(contactReceipt(reopened, sender, 'stable-request')).toMatchObject({
        submissionId: 42,
        result: answer(),
        expiresAt: null,
      })
      acknowledgeReceipt(reopened, receipt, 5000)
      acknowledgeReceipt(reopened, receipt, 6000)
      expect(contactReceipt(reopened, sender, 'stable-request')?.expiresAt).toBe(
        5000 + EXTENSION_RETENTION_MS,
      )
      retainContacts(reopened, 5000 + EXTENSION_RETENTION_MS)
      expect(contactReceipt(reopened, sender, 'stable-request')).toMatchObject({
        result: null,
        settledAt: 3000,
      })
      expect(reserveReceipt(reopened, sender, 'stable-request', 7000).settledAt).toBe(3000)
    })
  })

  it('caps UTF-8 text without splitting a code point and reports truncation explicitly', () => {
    expect(boundedContactResult('succeeded', 'a'.repeat(MAX_CONTACT_RESULT_BYTES)).truncated).toBe(
      false,
    )
    const result = boundedContactResult('succeeded', '語'.repeat(MAX_CONTACT_RESULT_BYTES))
    expect(result).toMatchObject({ outcome: 'succeeded', truncated: true })
    expect(new TextEncoder().encode(result.text).byteLength).toBe(65535)
    expect(result.text).not.toContain('\uFFFD')
    expect(result.text).toBe('語'.repeat(21845))
  })
})
