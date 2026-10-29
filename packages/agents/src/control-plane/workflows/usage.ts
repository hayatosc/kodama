/** Bounded, fair daily ingestion across all registry objects, independent of lifecycle. @module */
import { asc, eq, gt, lte } from 'drizzle-orm'
import { agents, systemSettings } from '../../../drizzle/management/schema.ts'
import { safeFailure } from '../../lib/errors.ts'
import { ingestUsage, usageCheckpoint } from '../usage.ts'
import type { ManagementCall } from './agents.ts'

/** Drain a small prefix per source, persisting sweep continuation even when a source fails. */
export async function aggregateUsage(call: ManagementCall): Promise<void> {
  const setting = await call.db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, 'usage_sweep_cursor'))
    .get()
  const cursor: unknown = setting ? JSON.parse(setting.valueJson) : ''
  if (typeof cursor !== 'string') throw new Error('Invalid usage sweep cursor')
  const after = await call.db
    .select()
    .from(agents)
    .where(gt(agents.agentId, cursor))
    .orderBy(asc(agents.agentId))
    .limit(20)
  const wrapped =
    after.length < 20 && cursor !== ''
      ? await call.db
          .select()
          .from(agents)
          .where(lte(agents.agentId, cursor))
          .orderBy(asc(agents.agentId))
          .limit(20 - after.length)
      : []
  const rows = [...after, ...wrapped]
  for (const source of rows) {
    try {
      const object = call.env.AGENTS.getByName(source.objectName)
      for (let pageNumber = 0; pageNumber < 5; pageNumber++) {
        const before = (await usageCheckpoint(call.db, source.agentId))?.lastSeq ?? 0
        // Covers a prior committed batch whose acknowledgment was lost.
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
    const valueJson = JSON.stringify(last.agentId)
    await call.db
      .insert(systemSettings)
      .values({ key: 'usage_sweep_cursor', valueJson })
      .onConflictDoUpdate({ target: systemSettings.key, set: { valueJson } })
  }
}
