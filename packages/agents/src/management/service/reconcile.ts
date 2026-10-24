/**
 * Daily reconciliation of the registry with the objects: push every desired version an object has
 * not applied, and finish agents stuck in `provisioning`.
 *
 * @see docs/agents.md — Applying versions
 *
 * @module
 */
import { and, asc, eq, gt, lte, ne, or } from 'drizzle-orm'
import { agents, systemSettings } from '../../../drizzle/management/schema.ts'
import { finishProvisioning, pushDesired } from './agents.ts'
import type { ManagementCall } from './agents.ts'

/** Agents handled per run; the rest wait for the next run. */
const RECONCILE_BATCH = 100

/** How many agents reconciliation pushed to, and how many of those are still behind. */
export interface ReconcileResult {
  pushed: number
  behind: number
}

/** Agents whose object is behind, or that never finished provisioning. */
const needsWork = or(
  ne(agents.currentVersion, agents.appliedVersion),
  eq(agents.status, 'provisioning'),
)

/** The agent ID the previous run stopped at; the next run starts after it. */
async function readCursor(call: ManagementCall): Promise<string> {
  const row = await call.db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, 'reconcile_cursor'))
    .get()
  return row === undefined ? '' : String(JSON.parse(row.valueJson))
}

async function writeCursor(call: ManagementCall, agentId: string): Promise<void> {
  const valueJson = JSON.stringify(agentId)
  await call.db
    .insert(systemSettings)
    .values({ key: 'reconcile_cursor', valueJson })
    .onConflictDoUpdate({ target: systemSettings.key, set: { valueJson } })
}

/**
 * The next agents to reconcile, in agent ID order, starting after `cursor` and wrapping around to
 * the first, so every agent that needs work is reached within a bounded number of runs.
 */
async function nextBatch(call: ManagementCall, cursor: string) {
  const after = await call.db
    .select()
    .from(agents)
    .where(and(needsWork, gt(agents.agentId, cursor)))
    .orderBy(asc(agents.agentId))
    .limit(RECONCILE_BATCH)
  if (after.length === RECONCILE_BATCH || cursor === '') return after
  const wrapped = await call.db
    .select()
    .from(agents)
    .where(and(needsWork, lte(agents.agentId, cursor)))
    .orderBy(asc(agents.agentId))
    .limit(RECONCILE_BATCH - after.length)
  return [...after, ...wrapped]
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
      console.error(`Reconciling agent ${row.agentId} failed`, error)
    }
  }
  const last = rows.at(-1)
  if (last !== undefined) await writeCursor(call, last.agentId)
  return { pushed: rows.length, behind }
}
