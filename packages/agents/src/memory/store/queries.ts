/**
 * Read-only D1 queries used by memory workflows; no tool definitions or prompt formatting.
 *
 * @module
 */
import { agentScope, parseMemoryRecord, parseScope } from './db.ts'
import type { MemoryDb, MemoryRecord, Scope } from './db.ts'
import selectActiveRecordRevision from './sql/select-active-record-revision.sql'
import selectActiveRecordsById from './sql/select-active-records-by-id.sql'
import selectPromptRecords from './sql/select-prompt-records.sql'
import selectScopeRevisions from './sql/select-scope-revisions.sql'

/** Current revisions for the scopes a prompt reads. */
export async function memoryRevisions(
  db: MemoryDb,
  scopes: readonly Scope[],
): Promise<Record<string, number>> {
  if (scopes.length === 0) return {}
  const rows = await selectScopeRevisions.run(db, { scopesJson: JSON.stringify(scopes) })
  return Object.fromEntries(rows.map((row) => [row.scope, row.revision]))
}

/**
 * The first `limit` active facts and instructions of `scopes` that `agentId` sees once overrides
 * apply, ordered by pin, importance, and last use.
 *
 * @param readable - Every scope the agent reads, which decides the overrides that apply.
 */
export async function promptRecords(
  db: MemoryDb,
  agentId: string,
  scopes: readonly Scope[],
  readable: readonly Scope[],
  limit: number,
  kinds: readonly ('fact' | 'instruction')[] = ['fact', 'instruction'],
): Promise<MemoryRecord[]> {
  if (scopes.length === 0 || kinds.length === 0 || limit <= 0) return []
  const rows = await selectPromptRecords.run(db, {
    own: agentScope(agentId),
    scopesJson: JSON.stringify(scopes),
    readableJson: JSON.stringify(readable),
    kindsJson: JSON.stringify(kinds),
    limit,
  })
  return rows.map(parseMemoryRecord)
}

/** Active evidence records for a proposed shared write. */
export async function activeRecordsById(
  db: MemoryDb,
  ids: readonly string[],
): Promise<MemoryRecord[]> {
  if (ids.length === 0) return []
  const rows = await selectActiveRecordsById.run(db, { idsJson: JSON.stringify(ids) })
  return rows.map(parseMemoryRecord)
}

/** The current scope and revision of an active replacement target. */
export async function activeRecordRevision(
  db: MemoryDb,
  id: string,
): Promise<{ scope: Scope; revision: number } | undefined> {
  const row = await selectActiveRecordRevision.run(db, { id })
  return row === null ? undefined : { scope: parseScope(row.scope), revision: row.revision }
}
