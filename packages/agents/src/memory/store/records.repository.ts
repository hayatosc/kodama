/**
 * Data-access repository for memory records, scope revisions, and record mutations in memory D1.
 *
 * @module
 */
import { prepareQuery } from '../../lib/reylo.ts'
import { agentScope, parseMemoryRecord, parseScope } from './db.ts'
import type { MemoryDb, MemoryRecord, Scope } from './db.ts'
import { queries } from './queries/index.ts'

/** Fetch one memory record row by ID, or `undefined` when absent. */
export async function findMemoryRecordById(
  db: MemoryDb,
  id: string,
): Promise<MemoryRecord | undefined> {
  const row = await queries.getMemoryRecordById.run(db, { id })
  return row === null ? undefined : parseMemoryRecord(row)
}

/** Current revisions for the scopes a prompt reads. */
export async function memoryRevisions(
  db: MemoryDb,
  scopes: readonly Scope[],
): Promise<Record<string, number>> {
  if (scopes.length === 0) return {}
  const rows = await queries.listScopeRevisions.run(db, { scopesJson: JSON.stringify(scopes) })
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
  const rows = await queries.listPromptRecords.run(db, {
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
  const rows = await queries.listActiveRecordsById.run(db, { idsJson: JSON.stringify(ids) })
  return rows.map(parseMemoryRecord)
}

/** Contents of every active record stored under `scope`. */
export async function listActiveRecordContents(db: MemoryDb, scope: Scope): Promise<string[]> {
  const rows = await queries.listActiveRecordContents.run(db, { scope })
  return rows.map((row) => row.content)
}

/** The current scope and revision of an active replacement target. */
export async function activeRecordRevision(
  db: MemoryDb,
  id: string,
): Promise<{ scope: Scope; revision: number } | undefined> {
  const row = await queries.getActiveRecordRevision.run(db, { id })
  return row === null ? undefined : { scope: parseScope(row.scope), revision: row.revision }
}

/** Prepare an insert statement for a new memory record row. */
export function insertMemoryRecordStatement(
  db: MemoryDb,
  params: {
    id: string
    scope: Scope
    kind: string
    content: string
    searchVersion: number
    origin: string
    sourceAgentId: string
    sourceEntryFrom: number | null
    sourceEntryTo: number | null
    runId: string
    importance: number
    required: boolean
    overrides: string | null
    observedAt: number
    createdAt: number
    updatedAt: number
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.insertMemoryRecord, params)
}

/** Prepare a revision-guarded statement marking an active record superseded. */
export function supersedeMemoryRecordStatement(
  db: MemoryDb,
  params: {
    id: string
    revision: number
    supersededBy: string
    nextRevision: number
    updatedAt: number
  },
): D1PreparedStatement {
  return prepareQuery(db, queries.updateMemoryRecordSuperseded, params)
}

/** Prepare a revision-guarded statement marking an active record invalid. */
export function invalidateMemoryRecordStatement(
  db: MemoryDb,
  params: { id: string; revision: number; nextRevision: number; updatedAt: number },
): D1PreparedStatement {
  return prepareQuery(db, queries.updateMemoryRecordInvalid, params)
}
