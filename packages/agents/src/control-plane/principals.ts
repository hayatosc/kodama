/**
 * Principals: the caller of management RPC as a principal row. The calling Worker authenticates its
 * caller, and `AgentService` trusts the actor it names; roles and permissions are issue #7.
 *
 * @see docs/agents.md — Management RPC
 *
 * @module
 */
import { and, eq } from 'drizzle-orm'
import { agents, principals } from '../../drizzle/management/schema.ts'
import { uuidv7 } from '../lib/uuid.ts'
import type { ManagementActor } from '../protocol.ts'
import type { ManagementDb, PrincipalRow } from './db.ts'

/** Resolve an existing, enabled creator without registering an unknown caller. */
export async function ownerPrincipal(db: ManagementDb, actor: ManagementActor, agentId: string) {
  const principal = await principalRow(db, actor)
  const agent = await db.select().from(agents).where(eq(agents.agentId, agentId)).get()
  if (!principal || principal.disabledAt !== null || agent?.ownerId !== principal.principalId)
    throw new Error('forbidden: caller is not the agent owner')
  return principal
}

async function principalRow(db: ManagementDb, actor: ManagementActor) {
  return db
    .select()
    .from(principals)
    .where(and(eq(principals.kind, actor.kind), eq(principals.externalId, actor.externalId)))
    .get()
}

/**
 * The principal `actor` names, registered on its first call so that owners, authors, and audit rows
 * can refer to it.
 *
 * @throws {@link Error} Starting `forbidden:`, when the principal is disabled, or its external ID is
 * registered under another kind.
 */
export async function principalOf(
  db: ManagementDb,
  actor: ManagementActor,
  now: number,
): Promise<PrincipalRow> {
  const known = await principalRow(db, actor)
  if (known === undefined) {
    await db
      .insert(principals)
      .values({
        principalId: uuidv7(now),
        kind: actor.kind,
        externalId: actor.externalId,
        displayName: actor.externalId,
        createdAt: now,
      })
      .onConflictDoNothing()
  }
  const principal = known ?? (await principalRow(db, actor))
  if (principal === undefined || principal.disabledAt !== null) {
    throw new Error(`forbidden: ${actor.kind}:${actor.externalId} may not call management RPC`)
  }
  return principal
}
