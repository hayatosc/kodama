/** Daily ingestion reaches inactive and dedicated objects and repairs lost acknowledgments. @module */
import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { expect, it } from 'vite-plus/test'
import { openLocalDb } from '../../agent/local-db/local.ts'
import selectUsageSince from '../../agent/local-db/sql/select-usage-since.sql'
import { MEMORY_AGENT_NAME } from '../../memory/jobs.ts'
import { credentialCall } from '../../testing/credentials.ts'
import { newAgentId, seedOnce } from '../../testing/management.ts'
import insertFullUsage from '../../testing/sql/insert-full-usage.sql'
import selectUsageDailyByAgent from '../../testing/sql/select-usage-daily-by-agent.sql'
import setAgentStatus from '../../testing/sql/set-agent-status.sql'
import { usageRecord } from '../../testing/usage.ts'
import { ingestUsage, usageCheckpoint } from '../usage.ts'
import { aggregateUsage } from './usage.ts'

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
    insertFullUsage.runSync(local.sql, toInsertParams(row))
  })
  await runInDurableObject(env.AGENTS.getByName(MEMORY_AGENT_NAME), async (_, state) => {
    const local = await openLocalDb(state.storage)
    insertFullUsage.runSync(
      local.sql,
      toInsertParams({ ...row, chargedAgentId: memoryId, actorKind: 'system' }),
    )
  })
  await setAgentStatus.run(call.db, { agentId: id, status: 'archived' })
  await ingestUsage(call.db, id, 0, { rows: [row], through: 1, more: false }, call.now)
  // The D1 commit succeeded but its response/acknowledgment was lost. A new sweep reads the cursor.
  await aggregateUsage(call)
  await aggregateUsage(call)
  expect((await usageCheckpoint(call.db, id))?.lastSeq).toBe(1)
  expect((await usageCheckpoint(call.db, memoryId))?.lastSeq).toBe(1)
  expect((await selectUsageDailyByAgent.run(call.db, { chargedAgentId: id }))[0]?.attempts).toBe(1)
  const localRow = await runInDurableObject(env.AGENTS.getByName(id), async (_, state) => {
    const local = await openLocalDb(state.storage)
    return selectUsageSince.runSync(local.sql, { after: 0, limit: 1 })[0]
  })
  expect(localRow?.aggregatedAt).not.toBeNull()
})
