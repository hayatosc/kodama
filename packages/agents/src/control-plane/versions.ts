/**
 * Configuration versions: the statements that write one, reading them back, and recording what an
 * object applied.
 *
 * @see docs/agents.md — Configuration versions
 *
 * @module
 */
import { SETTINGS_SCHEMA_VERSION } from '../control-plane/config.ts'
import { prepareQuery } from '../lib/reylo.ts'
import type { AgentSettings } from '../protocol.ts'
import { auditStatement } from './audit.ts'
import { parseVersionRow } from './db.ts'
import type { ManagementDb, VersionRow } from './db.ts'
import advanceDesiredVersion from './sql/advance-desired-version.sql'
import insertConfigVersion from './sql/insert-config-version.sql'
import reportAppliedVersion from './sql/report-applied-version.sql'
import selectConfigVersion from './sql/select-config-version.sql'
import selectConfigVersions from './sql/select-config-versions.sql'

/** Who writes a version, when, and its retry key. */
export interface VersionWrite {
  source: 'operator' | 'system'
  now: number
  opId: string
}

/**
 * The batch that writes `settings` as version `expected + 1`: the version, the registry's desired
 * version, and the audit row. A writer from a stale version fails on the version's primary key, so
 * its whole batch rolls back and leaves nothing behind.
 */
export function writeVersionStatements(
  db: ManagementDb,
  write: VersionWrite,
  agentId: string,
  expected: number,
  settings: AgentSettings,
  detail: { comment?: string; rollbackOf?: number },
): readonly [D1PreparedStatement, D1PreparedStatement, D1PreparedStatement] {
  const version = expected + 1
  return [
    prepareQuery(db, insertConfigVersion, {
      agentId,
      version,
      settingsJson: JSON.stringify(settings),
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      source: write.source,
      comment: detail.comment ?? null,
      createdAt: write.now,
    }),
    prepareQuery(db, advanceDesiredVersion, {
      version,
      updatedAt: write.now,
      agentId,
      expected,
    }),
    auditStatement(db, {
      opId: write.opId,
      at: write.now,
      source: write.source,
      action: detail.rollbackOf === undefined ? 'agent.config' : 'agent.config.rollback',
      targetKind: 'agent',
      targetId: agentId,
      detail: { version, ...detail },
    }),
  ] as const
}

/** One stored version, if it exists. */
export async function versionRow(
  db: ManagementDb,
  agentId: string,
  version: number,
): Promise<VersionRow | undefined> {
  const row = await selectConfigVersion.run(db, { agentId, version })
  return row === null ? undefined : parseVersionRow(row)
}

/** An agent's versions, newest first, before version `before` when given. */
export async function versionRows(
  db: ManagementDb,
  agentId: string,
  page: { before?: number; limit: number },
): Promise<VersionRow[]> {
  const rows = await selectConfigVersions.run(db, {
    agentId,
    before: page.before ?? null,
    limit: page.limit,
  })
  return rows.map(parseVersionRow)
}

/** Record that the agent's object applied `version`; never moves backwards or past desired. */
export async function reportApplied(
  db: ManagementDb,
  agentId: string,
  version: number,
): Promise<void> {
  await reportAppliedVersion.run(db, {
    version,
    agentId,
    appliedCeiling: version,
    desiredFloor: version,
  })
}
