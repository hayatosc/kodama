/**
 * Principals: resolving the caller of `AdminService`, and the owner check every administration
 * call makes until roles arrive (issue #5).
 *
 * @see docs/agents.md — AdminService
 *
 * @module
 */
import { and, eq } from 'drizzle-orm'
import { principals } from '../../drizzle/control/schema.ts'
import type { AdminActor } from '../protocol.ts'
import type { ControlDb, PrincipalRow } from './db.ts'

/**
 * The installation owner acting as `actor`.
 *
 * @throws {@link Error} Starting `forbidden:`, when `actor` is not an enabled principal with the owner role.
 */
export async function requireOwner(db: ControlDb, actor: AdminActor): Promise<PrincipalRow> {
  const principal = await db
    .select()
    .from(principals)
    .where(and(eq(principals.kind, actor.kind), eq(principals.externalId, actor.externalId)))
    .get()
  if (
    principal === undefined ||
    principal.disabledAt !== null ||
    principal.systemRole !== 'owner'
  ) {
    throw new Error(`forbidden: ${actor.kind}:${actor.externalId} is not the owner`)
  }
  return principal
}
