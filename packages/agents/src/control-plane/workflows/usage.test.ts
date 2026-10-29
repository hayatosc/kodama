/** Daily ingestion reaches inactive and dedicated objects and repairs lost acknowledgments. @module */
import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { agents, usageDaily } from '../../../drizzle/management/schema.ts'
import { usage } from '../../../drizzle/durable-object/schema.ts'
import { credentialCall } from '../../testing/credentials.ts'
import { newAgentId, seedOnce } from '../../testing/management.ts'
import { usageRecord } from '../../testing/usage.ts'
import { MEMORY_AGENT_NAME } from '../../memory/jobs.ts'
import { openLocalDb } from '../../agent/local-db/local.ts'
import { ingestUsage, usageCheckpoint } from '../usage.ts'
import { aggregateUsage } from './usage.ts'

it('repairs a committed but unacknowledged page and includes archived and dedicated agents', async () => {
  const call = await credentialCall()
  const id = await newAgentId()
  const memoryId = (await seedOnce()).memoryAgentId
  const row = usageRecord({ chargedAgentId: id })
  await runInDurableObject(env.AGENTS.getByName(id), async (_, state) => {
    ;(await openLocalDb(state.storage)).insert(usage).values(row).run()
  })
  await runInDurableObject(env.AGENTS.getByName(MEMORY_AGENT_NAME), async (_, state) => {
    ;(await openLocalDb(state.storage))
      .insert(usage)
      .values({ ...row, chargedAgentId: memoryId, actorKind: 'system' })
      .run()
  })
  await call.db.update(agents).set({ status: 'archived' }).where(eq(agents.agentId, id))
  await ingestUsage(call.db, id, 0, { rows: [row], through: 1, more: false }, call.now)
  // The D1 commit succeeded but its response/acknowledgment was lost. A new sweep reads the cursor.
  await aggregateUsage(call)
  await aggregateUsage(call)
  expect((await usageCheckpoint(call.db, id))?.lastSeq).toBe(1)
  expect((await usageCheckpoint(call.db, memoryId))?.lastSeq).toBe(1)
  expect(
    (await call.db.select().from(usageDaily).where(eq(usageDaily.chargedAgentId, id)).get())
      ?.attempts,
  ).toBe(1)
  const localRow = await runInDurableObject(env.AGENTS.getByName(id), async (_, state) =>
    (await openLocalDb(state.storage)).select().from(usage).get(),
  )
  expect(localRow?.aggregatedAt).not.toBeNull()
})
