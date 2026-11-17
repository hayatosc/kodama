/** Bounded, fair daily usage ingestion service across all registry objects. @module */
import { safeFailure } from '../../lib/errors.ts'
import { listAgentsAfterCursor, listAgentsWrap } from '../registry.repository.ts'
import { findSettingJson, upsertSetting } from '../settings.repository.ts'
import { ingestUsage, usageCheckpoint } from '../usage.service.ts'
import type { ManagementCall } from './agents.service.ts'

/** Drain a small prefix per source, persisting sweep continuation even when a source fails. */
export async function aggregateUsage(call: ManagementCall): Promise<void> {
  const rawCursor = await findSettingJson(call.db, 'usage_sweep_cursor')
  const cursor: unknown = rawCursor !== undefined ? JSON.parse(rawCursor) : ''
  if (typeof cursor !== 'string') throw new Error('Invalid usage sweep cursor')
  const after = await listAgentsAfterCursor(call.db, cursor, 20)
  const wrapped =
    after.length < 20 && cursor !== ''
      ? await listAgentsWrap(call.db, cursor, 20 - after.length)
      : []
  const rows = [...after, ...wrapped]
  for (const source of rows) {
    try {
      const object = call.env.AGENTS.getByName(source.objectName)
      for (let pageNumber = 0; pageNumber < 5; pageNumber++) {
        const before = (await usageCheckpoint(call.db, source.agentId))?.lastSeq ?? 0
        await object.acknowledgeUsage(before)
        using page = await object.usageSince(before, 20)
        await ingestUsage(call.db, source.agentId, before, page, call.now)
        const committed = await usageCheckpoint(call.db, source.agentId)
        await object.acknowledgeUsage(committed?.lastSeq ?? before)
        if (!page.more || page.through === before) break
      }
    } catch (error) {
      console.error('Usage aggregation failed', source.agentId, safeFailure(error))
    }
  }
  const last = rows.at(-1)
  if (last) {
    await upsertSetting(call.db, 'usage_sweep_cursor', JSON.stringify(last.agentId))
  }
}
