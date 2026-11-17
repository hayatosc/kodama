/**
 * Configuration versions service: writing new immutable versions, reading history, and reporting
 * applied versions.
 *
 * @see docs/agents.md — Configuration versions
 *
 * @module
 */
import type { AgentSettings } from '../protocol.ts'
import { auditStatement } from './audit.repository.ts'
import { SETTINGS_SCHEMA_VERSION } from './config.ts'
import type { ManagementDb, VersionRow } from './db.ts'
import { advanceDesiredVersionStatement, reportAppliedVersion } from './registry.repository.ts'
import {
  findConfigVersion,
  insertConfigVersionStatement,
  listConfigVersionRows,
} from './versions.repository.ts'

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
    insertConfigVersionStatement(db, {
      agentId,
      version,
      settingsJson: JSON.stringify(settings),
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      source: write.source,
      comment: detail.comment ?? null,
      createdAt: write.now,
    }),
    advanceDesiredVersionStatement(db, {
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
  return findConfigVersion(db, agentId, version)
}

/** An agent's versions, newest first, before version `before` when given. */
export async function versionRows(
  db: ManagementDb,
  agentId: string,
  page: { before?: number; limit: number },
): Promise<VersionRow[]> {
  return listConfigVersionRows(db, agentId, page)
}

/** Record that the agent's object applied `version`; never moves backwards or past desired. */
export async function reportApplied(
  db: ManagementDb,
  agentId: string,
  version: number,
): Promise<void> {
  await reportAppliedVersion(db, agentId, version)
}
