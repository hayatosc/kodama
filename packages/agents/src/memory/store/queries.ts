/**
 * Read-only D1 queries used by memory workflows; no tool definitions or prompt formatting.
 *
 * @module
 */
import { and, desc, eq, inArray, ne, notExists, or } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { memoryRecords, scopeRevisions } from '../../../drizzle/memory/schema.ts'
import type { Scope } from '../../../drizzle/memory/schema.ts'
import { agentScope } from './db.ts'
import type { MemoryDb } from './db.ts'

/**
 * The condition that keeps only the records `agentId` sees once overrides apply: its own records,
 * except those overriding a required shared record, and shared records it has not overridden.
 *
 * @remarks
 * Resolving this in SQL lets a query rank and limit the visible records only.
 */
export function effectiveForAgent(db: MemoryDb, agentId: string, scopes: readonly Scope[]) {
  const own = agentScope(agentId)
  const target = alias(memoryRecords, 'required_target')
  const override = alias(memoryRecords, 'agent_override')
  const requiredTarget = db
    .select({ id: target.id })
    .from(target)
    .where(
      and(
        eq(target.id, memoryRecords.overrides),
        eq(target.status, 'active'),
        eq(target.required, true),
        ne(target.scope, own),
        inArray(target.scope, [...scopes]),
      ),
    )
  const ownOverride = db
    .select({ id: override.id })
    .from(override)
    .where(
      and(
        eq(override.overrides, memoryRecords.id),
        eq(override.scope, own),
        eq(override.status, 'active'),
      ),
    )
  return or(
    and(eq(memoryRecords.scope, own), notExists(requiredTarget)),
    and(ne(memoryRecords.scope, own), or(eq(memoryRecords.required, true), notExists(ownOverride))),
  )
}

/** Current revisions for the scopes a prompt reads. */
export async function memoryRevisions(
  db: MemoryDb,
  scopes: Scope[],
): Promise<Record<string, number>> {
  const rows = await db.select().from(scopeRevisions).where(inArray(scopeRevisions.scope, scopes))
  return Object.fromEntries(rows.map((row) => [row.scope, row.revision]))
}

/**
 * The first `limit` active facts and instructions of `scopes` that `agentId` sees once overrides
 * apply, ordered by pin, importance, and last use.
 *
 * @param readable - Every scope the agent reads, which decides the overrides that apply.
 */
export function promptRecords(
  db: MemoryDb,
  agentId: string,
  scopes: Scope[],
  readable: readonly Scope[],
  limit: number,
) {
  return db
    .select()
    .from(memoryRecords)
    .where(
      and(
        inArray(memoryRecords.scope, scopes),
        eq(memoryRecords.status, 'active'),
        inArray(memoryRecords.kind, ['fact', 'instruction']),
        effectiveForAgent(db, agentId, readable),
      ),
    )
    .orderBy(
      desc(memoryRecords.pinned),
      desc(memoryRecords.importance),
      // SQLite orders NULL first ascending, so never-used records come last descending.
      desc(memoryRecords.lastUsedAt),
    )
    .limit(limit)
}

/** Active evidence records for a proposed shared write. */
export function activeRecordsById(db: MemoryDb, ids: readonly string[]) {
  return db
    .select()
    .from(memoryRecords)
    .where(and(inArray(memoryRecords.id, [...ids]), eq(memoryRecords.status, 'active')))
}

/** The current scope and revision of an active replacement target. */
export function activeRecordRevision(db: MemoryDb, id: string) {
  return db
    .select({ scope: memoryRecords.scope, revision: memoryRecords.revision })
    .from(memoryRecords)
    .where(and(eq(memoryRecords.id, id), eq(memoryRecords.status, 'active')))
    .get()
}
