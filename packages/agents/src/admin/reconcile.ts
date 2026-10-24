/**
 * Daily reconciliation of the registry with the objects: push every desired version an object has
 * not applied, and finish agents stuck in `provisioning`.
 *
 * @see docs/agents.md — Applying versions
 *
 * @module
 */
import { eq, ne, or } from 'drizzle-orm'
import { agents } from '../../drizzle/management/schema.ts'
import { finishProvisioning, pushDesired } from './agents.ts'
import type { AdminCall } from './agents.ts'

/** Agents handled per run; the rest wait for the next day. */
const RECONCILE_BATCH = 100

/** How many agents reconciliation pushed to, and how many of those are still behind. */
export interface ReconcileResult {
  pushed: number
  behind: number
}

/**
 * Push desired versions that are not applied, and finish provisioning. One agent's failure is
 * logged and does not stop the others.
 */
export async function reconcileAgents(call: AdminCall): Promise<ReconcileResult> {
  const rows = await call.db
    .select()
    .from(agents)
    .where(or(ne(agents.currentVersion, agents.appliedVersion), eq(agents.status, 'provisioning')))
    .orderBy(agents.updatedAt)
    .limit(RECONCILE_BATCH)
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
  return { pushed: rows.length, behind }
}
