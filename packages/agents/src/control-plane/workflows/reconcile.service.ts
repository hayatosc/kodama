/**
 * Daily reconciliation service of the registry with the objects: push every desired version an
 * object has not applied, and finish agents stuck in `provisioning`.
 *
 * @see docs/agents.md — Applying versions
 *
 * @module
 */
import { safeFailure } from '../../lib/errors.ts'
import { listAgentsForReconcile, listAgentsForReconcileWrap } from '../registry.repository.ts'
import { findSettingJson, upsertSetting } from '../settings.repository.ts'
import { finishProvisioning, pushDesired } from './agents.service.ts'
import type { ManagementCall } from './agents.service.ts'

const RECONCILE_BATCH = 100

/** How many agents reconciliation pushed to, and how many of those are still behind. */
export interface ReconcileResult {
  pushed: number
  behind: number
}

async function readCursor(call: ManagementCall): Promise<string> {
  const raw = await findSettingJson(call.db, 'reconcile_cursor')
  return raw === undefined ? '' : String(JSON.parse(raw))
}

async function writeCursor(call: ManagementCall, agentId: string): Promise<void> {
  await upsertSetting(call.db, 'reconcile_cursor', JSON.stringify(agentId))
}

async function nextBatch(call: ManagementCall, cursor: string) {
  const after = await listAgentsForReconcile(call.db, cursor, RECONCILE_BATCH)
  if (after.length === RECONCILE_BATCH || cursor === '') return after
  const wrapped = await listAgentsForReconcileWrap(call.db, cursor, RECONCILE_BATCH - after.length)
  return [...after, ...wrapped]
}

/**
 * Push desired versions that are not applied, and finish provisioning. One agent's failure is
 * logged and does not stop the others.
 */
export async function reconcileAgents(call: ManagementCall): Promise<ReconcileResult> {
  const rows = await nextBatch(call, await readCursor(call))
  let behind = 0
  for (const row of rows) {
    try {
      const after =
        row.status === 'provisioning'
          ? (await finishProvisioning(call, row.agentId)).appliedVersion
          : (await pushDesired(call, row.agentId)).appliedVersion
      if (after < row.currentVersion) behind++
    } catch (error) {
      behind++
      console.error(`Reconciling agent ${row.agentId} failed`, safeFailure(error))
    }
  }
  const last = rows.at(-1)
  if (last !== undefined) await writeCursor(call, last.agentId)
  return { pushed: rows.length, behind }
}
