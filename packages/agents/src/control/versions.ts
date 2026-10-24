/**
 * Configuration versions: the statements that write one, reading them back, and recording what an
 * object applied.
 *
 * @see docs/agents.md — Configuration versions
 *
 * @module
 */
import { and, desc, eq, lt } from 'drizzle-orm'
import { agentConfigVersions, agents } from '../../drizzle/control/schema.ts'
import { SETTINGS_SCHEMA_VERSION } from '../configuration/index.ts'
import type { AgentSettings } from '../protocol.ts'
import { auditStatement } from './audit.ts'
import type { ControlDb, VersionRow } from './db.ts'

/** Who writes a version, when, and its retry key. */
export interface VersionWrite {
  /** The acting principal; `null` for the system. */
  actorId: string | null
  now: number
  opId: string
}

/**
 * The batch that writes `settings` as version `expected + 1`: the version, the registry's desired
 * version, and the audit row. A writer from a stale version fails on the version's primary key, so
 * its whole batch rolls back and leaves nothing behind.
 */
export function writeVersionStatements(
  db: ControlDb,
  write: VersionWrite,
  agentId: string,
  expected: number,
  settings: AgentSettings,
  detail: { comment?: string; rollbackOf?: number },
) {
  const version = expected + 1
  return [
    db.insert(agentConfigVersions).values({
      agentId,
      version,
      settingsJson: JSON.stringify(settings),
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      authorId: write.actorId,
      comment: detail.comment ?? null,
      createdAt: write.now,
    }),
    db
      .update(agents)
      .set({ currentVersion: version, updatedAt: write.now })
      .where(and(eq(agents.agentId, agentId), eq(agents.currentVersion, expected))),
    auditStatement(db, {
      opId: write.opId,
      at: write.now,
      actorId: write.actorId,
      action: detail.rollbackOf === undefined ? 'agent.config' : 'agent.config.rollback',
      targetKind: 'agent',
      targetId: agentId,
      detail: { version, ...detail },
    }),
  ] as const
}

/** One stored version, if it exists. */
export function versionRow(
  db: ControlDb,
  agentId: string,
  version: number,
): Promise<VersionRow | undefined> {
  return db
    .select()
    .from(agentConfigVersions)
    .where(and(eq(agentConfigVersions.agentId, agentId), eq(agentConfigVersions.version, version)))
    .get()
}

/** An agent's versions, newest first, before version `before` when given. */
export function versionRows(
  db: ControlDb,
  agentId: string,
  page: { before?: number; limit: number },
): Promise<VersionRow[]> {
  const conditions = [
    eq(agentConfigVersions.agentId, agentId),
    page.before === undefined ? undefined : lt(agentConfigVersions.version, page.before),
  ]
  return db
    .select()
    .from(agentConfigVersions)
    .where(and(...conditions))
    .orderBy(desc(agentConfigVersions.version))
    .limit(page.limit)
}

/** Record that the agent's object applied `version`; never moves backwards or past desired. */
export function reportApplied(db: ControlDb, agentId: string, version: number) {
  return db
    .update(agents)
    .set({ appliedVersion: version })
    .where(and(eq(agents.agentId, agentId), lt(agents.appliedVersion, version)))
}
