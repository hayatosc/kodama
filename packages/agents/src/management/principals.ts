/**
 * Principals: the caller of `ManagementService` as a principal row. The calling Worker authenticates its
 * caller, and `ManagementService` trusts the actor it names; roles and permissions are issue #7.
 *
 * @see docs/agents.md — ManagementService
 *
 * @module
 */
import { and, eq } from 'drizzle-orm'
import { principals } from '../../drizzle/management/schema.ts'
import { uuidv7 } from '../lib/uuid.ts'
import type { ManagementActor } from '../protocol.ts'
import type { ManagementDb, PrincipalRow } from './db.ts'

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
    throw new Error(`forbidden: ${actor.kind}:${actor.externalId} may not call ManagementService`)
  }
  return principal
}
