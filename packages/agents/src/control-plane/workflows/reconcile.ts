/**
 * Daily reconciliation of the registry with the objects: push every desired version an object has
 * not applied, and finish agents stuck in `provisioning`.
 *
 * @see docs/agents.md — Applying versions
 *
 * @module
 */
import { safeFailure } from '../../lib/errors.ts'
import { parseAgentRow } from '../db.ts'
import listAgentsForReconcileWrap from '../sql/list-agents-for-reconcile-wrap.sql'
import listAgentsForReconcile from '../sql/list-agents-for-reconcile.sql'
import selectSetting from '../sql/select-setting.sql'
import upsertSetting from '../sql/upsert-setting.sql'
import { finishProvisioning, pushDesired } from './agents.ts'
import type { ManagementCall } from './agents.ts'

/** Agents handled per run; the rest wait for the next run. */
const RECONCILE_BATCH = 100

/** How many agents reconciliation pushed to, and how many of those are still behind. */
export interface ReconcileResult {
  pushed: number
  behind: number
}

/** The agent ID the previous run stopped at; the next run starts after it. */
async function readCursor(call: ManagementCall): Promise<string> {
  const row = await selectSetting.run(call.db, { key: 'reconcile_cursor' })
  return row === null ? '' : String(JSON.parse(row.valueJson))
}

async function writeCursor(call: ManagementCall, agentId: string): Promise<void> {
  await upsertSetting.run(call.db, {
    key: 'reconcile_cursor',
    valueJson: JSON.stringify(agentId),
  })
}

/**
 * The next agents to reconcile, in agent ID order, starting after `cursor` and wrapping around to
 * the first, so every agent that needs work is reached within a bounded number of runs.
 */
async function nextBatch(call: ManagementCall, cursor: string) {
  const after = await listAgentsForReconcile.run(call.db, { cursor, limit: RECONCILE_BATCH })
  if (after.length === RECONCILE_BATCH || cursor === '') return after.map(parseAgentRow)
  const wrapped = await listAgentsForReconcileWrap.run(call.db, {
    cursor,
    limit: RECONCILE_BATCH - after.length,
  })
  return [...after, ...wrapped].map(parseAgentRow)
}

/**
 * Push desired versions that are not applied, and finish provisioning. One agent's failure is
 * logged and does not stop the others.
 *
 * @remarks
 * Each run takes at most {@link RECONCILE_BATCH} agents and continues where the previous run
 * stopped (`system_settings.reconcile_cursor`), so agents that keep failing cannot keep the ones
 * after them from ever being pushed.
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
