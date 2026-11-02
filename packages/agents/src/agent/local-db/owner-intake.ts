/** Durable owner reply fences and UI Worker delivery receipts.
 * @module
 */
import { desc, eq, or } from 'drizzle-orm'
import { ownerReplies, ownerDeliveries } from '../../../drizzle/durable-object/schema.ts'
import type { OwnerReply, OwnerDelivery } from '../../owner-intake.ts'
import type { LocalDb } from './local.ts'

/** Find the owner fence for an RPC request ID without admitting new work. */
export function ownerReplyReceipt(db: LocalDb, requestId: string) {
  return db.select().from(ownerReplies).where(eq(ownerReplies.requestId, requestId)).get()
}

/** Reserve identity before Pi admission; a crash is recovered with the same request ID. */
export function reserveOwnerReply(db: LocalDb, input: OwnerReply, now: number) {
  const args = JSON.stringify(input)
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(ownerReplies)
      .where(
        or(
          eq(ownerReplies.requestId, input.requestId),
          eq(ownerReplies.externalMessageId, input.externalMessageId),
        ),
      )
      .get()
    if (existing) {
      if (existing.arguments !== args) throw new TypeError('owner_reply_replay_mismatch')
      return { receipt: existing, replay: true }
    }
    const last = tx.select().from(ownerReplies).orderBy(desc(ownerReplies.sequence)).limit(1).get()
    if (input.sequence !== (last?.sequence ?? 0) + 1)
      throw new TypeError('owner_reply_out_of_order')
    if (input.deliveryId) {
      const delivery = tx
        .select()
        .from(ownerDeliveries)
        .where(eq(ownerDeliveries.id, input.deliveryId))
        .get()
      if (delivery?.state !== 'accepted') throw new TypeError('owner_reply_delivery_not_accepted')
    }
    const receipt = tx
      .insert(ownerReplies)
      .values({
        requestId: input.requestId,
        externalMessageId: input.externalMessageId,
        sequence: input.sequence,
        arguments: args,
        state: 'unknown',
        createdAt: now,
      })
      .returning()
      .get()
    return { receipt, replay: false }
  })
}

/** Record successful admission without rewriting the immutable transport identity. */
export function acceptOwnerReply(db: LocalDb, requestId: string, submissionId: number | null) {
  db.update(ownerReplies)
    .set({ submissionId, state: 'accepted' })
    .where(eq(ownerReplies.requestId, requestId))
    .run()
}

/** Read accepted submissions for lazy, idempotent reconciliation with Pi. */
export function ownerReplyReceipts(db: LocalDb) {
  return db.select().from(ownerReplies).orderBy(ownerReplies.sequence).all()
}

/** Insert an immutable source reference, initially with no confirmed receiver. */
export function queueOwnerDelivery(
  db: LocalDb,
  source: OwnerDelivery['source'],
  sourceId: string,
  now: number,
) {
  db.insert(ownerDeliveries)
    .values({
      id: `${source}-${sourceId}`,
      source,
      sourceId,
      state: 'unknown',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run()
}

/** Read receipts; result bodies remain in the existing submission/inbox APIs. */
export function ownerDeliveryPage(db: LocalDb) {
  return db
    .select()
    .from(ownerDeliveries)
    .orderBy(desc(ownerDeliveries.createdAt), ownerDeliveries.id)
    .all()
}

/** Accept redelivery after failure; confirmed receipt cannot be reversed by a late failure. */
export function reportOwnerDelivery(
  db: LocalDb,
  id: string,
  state: 'accepted' | 'failed',
  now: number,
) {
  return db.transaction((tx) => {
    const row = tx.select().from(ownerDeliveries).where(eq(ownerDeliveries.id, id)).get()
    if (!row) throw new TypeError('unknown_delivery')
    if (row.state === 'accepted' && state !== 'accepted')
      throw new TypeError('delivery_report_conflict')
    if (row.state === state) return row
    return tx
      .update(ownerDeliveries)
      .set({ state, updatedAt: now })
      .where(eq(ownerDeliveries.id, id))
      .returning()
      .get()
  })
}
