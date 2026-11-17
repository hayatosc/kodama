/**
 * Data-access repository for configuration versions in management D1.
 *
 * @see docs/agents.md — Configuration versions
 *
 * @module
 */
import { prepareQuery } from '../lib/reylo.ts'
import { parseVersionRow } from './db.ts'
import type { ManagementDb, VersionRow } from './db.ts'
import { queries } from './queries/index.ts'

/** Parameters required to insert a configuration version row. */
export interface InsertConfigVersionParams {
  agentId: string
  version: number
  settingsJson: string
  schemaVersion: number
  source: 'operator' | 'system'
  comment: string | null
  createdAt: number
}

/** Prepare an insert statement for one immutable configuration version row. */
export function insertConfigVersionStatement(
  db: ManagementDb,
  params: InsertConfigVersionParams,
): D1PreparedStatement {
  return prepareQuery(db, queries.insertConfigVersion, params)
}

/** Fetch one stored configuration version, if it exists. */
export async function findConfigVersion(
  db: ManagementDb,
  agentId: string,
  version: number,
): Promise<VersionRow | undefined> {
  const row = await queries.getConfigVersion.run(db, { agentId, version })
  return row === null ? undefined : parseVersionRow(row)
}

/** List an agent's configuration versions, newest first, before `before` when given. */
export async function listConfigVersionRows(
  db: ManagementDb,
  agentId: string,
  page: { before?: number; limit: number },
): Promise<VersionRow[]> {
  const rows = await queries.listConfigVersions.run(db, {
    agentId,
    before: page.before ?? null,
    limit: page.limit,
  })
  return rows.map(parseVersionRow)
}
