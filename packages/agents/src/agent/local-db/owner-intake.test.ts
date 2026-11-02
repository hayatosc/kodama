/** Owner intake and UI receipt round trips through real RPC and object SQLite.
 * @module
 */
import { env, exports } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { caller, newAgentId, management, principalIdOf } from '../../testing/management.ts'
import { useMockModel, waitForAnswer, rpcRejection } from '../../testing/rpc.ts'
import { principals } from '../../../drizzle/management/schema.ts'
import { notifications } from '../../../drizzle/durable-object/schema.ts'
import { piEntries } from './pi-tables.ts'
import { openLocalDb } from './local.ts'
import { recordNotification } from './notifications.ts'
import { reserveOwnerReply, queueOwnerDelivery, reportOwnerDelivery } from './owner-intake.ts'
import { OwnerReplySchema, parseInput } from '../../validation.ts'
import { uuidv7 } from '../../lib/uuid.ts'
import type { OwnerReply } from '../../owner-intake.ts'

useMockModel()

function reply(sequence = 1): OwnerReply {
  return {
    requestId: uuidv7(),
    externalMessageId: uuidv7(),
    sequence,
    action: 'followUp',
    content: 'Hello',
  }
}

describe('owner transport', () => {
  it('binds host provenance, executes once, records UI receipt, and accepts a sequenced reply', async () => {
    const agentId = await newAgentId()
    const actor = await caller()
    const input = { ...reply(), requestId: 'r'.repeat(128) }
    const first = await exports.default.ownerReply(actor, agentId, input)
    expect(first.state).toBe('accepted')
    expect(await exports.default.ownerReply(actor, agentId, input)).toEqual(first)
    await waitForAnswer(agentId, input.requestId)
    const page = await exports.default.ownerDeliveries(actor, agentId)
    expect(page.nextSequence).toBe(2)
    const delivery = page.deliveries.find((row) => row.sourceId === input.requestId)
    if (!delivery) throw new Error('Missing submission delivery')
    expect(delivery.state).toBe('unknown')
    const report = { id: delivery.id, state: 'accepted' } as const
    expect((await exports.default.reportOwnerDelivery(actor, agentId, report)).state).toBe(
      'accepted',
    )
    expect((await exports.default.reportOwnerDelivery(actor, agentId, report)).state).toBe(
      'accepted',
    )
    const second = { ...reply(2), deliveryId: delivery.id, action: 'steer' } as const
    await exports.default.ownerReply(actor, agentId, second)
    await waitForAnswer(agentId, second.requestId)
    const principalId = await principalIdOf(actor)
    await runInDurableObject(env.AGENTS.getByName(agentId), async (_agent, state) => {
      const db = await openLocalDb(state.storage)
      const entries = db.select().from(piEntries).all()
      const owned = entries.filter((entry) =>
        JSON.stringify(entry.record).includes(input.externalMessageId),
      )
      expect(owned).toHaveLength(1)
      expect(JSON.stringify(owned)).toContain(principalId)
      expect(JSON.stringify(owned)).toContain(input.requestId)
    })
    const cancel = {
      requestId: uuidv7(),
      externalMessageId: uuidv7(),
      sequence: 3,
      action: 'cancel',
    } as const
    expect((await exports.default.ownerReply(actor, agentId, cancel)).state).toBe('accepted')
    expect((await exports.default.ownerReply(actor, agentId, cancel)).state).toBe('accepted')
  })

  it('rejects impostors, disabled owners, identity substitutions, and out-of-order input', async () => {
    const agentId = await newAgentId()
    const actor = await caller()
    const input = reply()
    const stranger = { kind: 'user', externalId: uuidv7() } as const
    expect(await rpcRejection(exports.default.ownerReply(stranger, agentId, input))).toContain(
      'forbidden',
    )
    expect(
      await management
        .select()
        .from(principals)
        .where(eq(principals.externalId, stranger.externalId)),
    ).toEqual([])
    // Management still registers first-time authenticated callers; that grants no agent ownership.
    await exports.default.getInstallationId(stranger)
    expect(
      await management
        .select()
        .from(principals)
        .where(eq(principals.externalId, stranger.externalId)),
    ).toHaveLength(1)
    expect(await rpcRejection(exports.default.ownerReply(stranger, agentId, input))).toContain(
      'forbidden',
    )
    expect(
      await rpcRejection(exports.default.ownerReply(actor, agentId, { ...input, sequence: 2 })),
    ).toContain('out_of_order')
    await exports.default.ownerReply(actor, agentId, input)
    await waitForAnswer(agentId, input.requestId)
    expect(
      await rpcRejection(
        exports.default.ownerReply(actor, agentId, { ...input, content: 'different' }),
      ),
    ).toContain('replay_mismatch')
    expect(
      await rpcRejection(
        exports.default.ownerReply(actor, agentId, { ...input, requestId: uuidv7() }),
      ),
    ).toContain('replay_mismatch')
    expect(
      await rpcRejection(
        exports.default.ownerReply(actor, agentId, { ...reply(2), deliveryId: 'absent' }),
      ),
    ).toContain('not_accepted')
    const principalId = await principalIdOf(actor)
    await management
      .update(principals)
      .set({ disabledAt: Date.now() })
      .where(eq(principals.principalId, principalId))
    try {
      expect(await rpcRejection(exports.default.ownerDeliveries(actor, agentId))).toContain(
        'forbidden',
      )
    } finally {
      await management
        .update(principals)
        .set({ disabledAt: null })
        .where(eq(principals.principalId, principalId))
    }
    expect(() => parseInput(OwnerReplySchema, { ...reply(), principalId })).toThrow()
  })

  it('does not adopt lower-level submissions or allow them to reuse owner request IDs', async () => {
    const agentId = await newAgentId()
    const actor = await caller()
    const old = reply()
    await exports.default.sendMessage(agentId, { requestId: old.requestId, content: 'Legacy' })
    await waitForAnswer(agentId, old.requestId)
    expect(await rpcRejection(exports.default.ownerReply(actor, agentId, old))).toContain(
      'request_id_reserved',
    )
    const owned = reply()
    await exports.default.ownerReply(actor, agentId, owned)
    await waitForAnswer(agentId, owned.requestId)
    expect(
      await rpcRejection(
        exports.default.sendMessage(agentId, { requestId: owned.requestId, content: 'Overwrite' }),
      ),
    ).toContain('request_id_reserved')
  })

  it('accepts redelivery after failure without marking notifications read or reversing acceptance', async () => {
    const agentId = await newAgentId()
    const actor = await caller()
    await runInDurableObject(env.AGENTS.getByName(agentId), async (_agent, state) => {
      recordNotification(
        await openLocalDb(state.storage),
        {
          source: 'contact',
          sourceId: 'test-result',
          outcome: 'succeeded',
          summary: 'Complete',
          artifactIds: [],
        },
        Date.now(),
      )
    })
    const page = await exports.default.ownerDeliveries(actor, agentId)
    const delivery = page.deliveries.find((row) => row.source === 'notification')
    if (!delivery) throw new Error('Missing notification delivery')
    const failed = await exports.default.reportOwnerDelivery(actor, agentId, {
      id: delivery.id,
      state: 'failed',
    })
    expect(failed.state).toBe('failed')
    expect(
      await exports.default.reportOwnerDelivery(actor, agentId, {
        id: delivery.id,
        state: 'failed',
      }),
    ).toEqual(failed)
    expect(await exports.default.attention(actor, agentId)).toContainEqual(
      expect.objectContaining({ id: delivery.id, reason: 'delivery_failed' }),
    )
    const accepted = await exports.default.reportOwnerDelivery(actor, agentId, {
      id: delivery.id,
      state: 'accepted',
    })
    expect(accepted.state).toBe('accepted')
    expect(
      await exports.default.reportOwnerDelivery(actor, agentId, {
        id: delivery.id,
        state: 'accepted',
      }),
    ).toEqual(accepted)
    expect(await exports.default.attention(actor, agentId)).not.toContainEqual(
      expect.objectContaining({ id: delivery.id }),
    )
    expect(
      await rpcRejection(
        exports.default.reportOwnerDelivery(actor, agentId, { id: delivery.id, state: 'failed' }),
      ),
    ).toContain('conflict')
    await runInDurableObject(env.AGENTS.getByName(agentId), async (_agent, state) => {
      expect(
        (await openLocalDb(state.storage)).select().from(notifications).get()?.readAt,
      ).toBeNull()
    })
  })

  it('preserves unknown reservations and receipt state across reopening the database', async () => {
    const agentId = await newAgentId()
    const actor = await caller()
    const principalId = await principalIdOf(actor)
    const input = reply()
    await runInDurableObject(env.AGENTS.getByName(agentId), async (_agent, state) => {
      const db = await openLocalDb(state.storage)
      expect(reserveOwnerReply(db, principalId, input, 10).replay).toBe(false)
      const reopened = await openLocalDb(state.storage)
      expect(reserveOwnerReply(reopened, principalId, input, 20).replay).toBe(true)
      queueOwnerDelivery(reopened, 'submission', input.requestId, 30)
      reportOwnerDelivery(reopened, `submission-${input.requestId}`, 'failed', 40)
    })
    const result = await exports.default.ownerReply(actor, agentId, input)
    expect(result.state).toBe('accepted')
    await waitForAnswer(agentId, input.requestId)
    const items = await exports.default.attention(actor, agentId)
    expect(items).toContainEqual({
      source: 'delivery',
      id: `submission-${input.requestId}`,
      reason: 'delivery_failed',
      lastProgressAt: 40,
      actions: [],
    })
  })
})
