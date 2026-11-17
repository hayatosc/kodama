/** Daily ingestion reaches inactive and dedicated objects and repairs lost acknowledgments. @module */
import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { expect, it } from 'vite-plus/test'
import { openLocalDb } from '../../agent/local-db/local.ts'
import { usageSince } from '../../agent/local-db/usage.repository.ts'
import { MEMORY_AGENT_NAME } from '../../memory/jobs.ts'
import { credentialCall } from '../../testing/credentials.ts'
import { newAgentId, seedOnce } from '../../testing/management.ts'
import {
  insertFullUsage,
  listUsageDailyByAgent,
  updateAgentStatus,
} from '../../testing/test-db.repository.ts'
import { usageRecord } from '../../testing/usage.ts'
import { ingestUsage, usageCheckpoint } from '../usage.service.ts'
import { aggregateUsage } from './usage.service.ts'

function toInsertParams(row: ReturnType<typeof usageRecord>) {
  return {
    ...row,
    rateLimited: row.rateLimited ? 1 : 0,
  }
}

it('repairs a committed but unacknowledged page and includes archived and dedicated agents', async () => {
  const call = credentialCall()
  const id = await newAgentId()
  const memoryId = (await seedOnce()).memoryAgentId
  const row = usageRecord({ chargedAgentId: id })
  await runInDurableObject(env.AGENTS.getByName(id), async (_, state) => {
    const local = await openLocalDb(state.storage)
    insertFullUsage(local.sql, toInsertParams(row))
  })
  await runInDurableObject(env.AGENTS.getByName(MEMORY_AGENT_NAME), async (_, state) => {
    const local = await openLocalDb(state.storage)
    insertFullUsage(
      local.sql,
      toInsertParams({ ...row, chargedAgentId: memoryId, actorKind: 'system' }),
    )
  })
  await updateAgentStatus(call.db, { agentId: id, status: 'archived' })
  await ingestUsage(call.db, id, 0, { rows: [row], through: 1, more: false }, call.now)
  // The D1 commit succeeded but its response/acknowledgment was lost. A new sweep reads the cursor.
  await aggregateUsage(call)
  await aggregateUsage(call)
  expect((await usageCheckpoint(call.db, id))?.lastSeq).toBe(1)
  expect((await usageCheckpoint(call.db, memoryId))?.lastSeq).toBe(1)
  expect((await listUsageDailyByAgent(call.db, { chargedAgentId: id }))[0]?.attempts).toBe(1)
  const localRow = await runInDurableObject(env.AGENTS.getByName(id), async (_, state) => {
    const local = await openLocalDb(state.storage)
    return usageSince(local, 0, 1).rows[0]
  })
  expect(localRow?.aggregatedAt).not.toBeNull()
})
