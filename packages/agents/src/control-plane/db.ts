/**
 * The management database: its D1 handle, enum constants, and row types.
 *
 * @see docs/agents.md — Management database
 *
 * @module
 */
import { parseEnum, parseNullableEnum } from '../lib/reylo.ts'

/** Management actions originate from the authenticated operator or internal automation, not users. */
export const MANAGEMENT_SOURCES = ['operator', 'system'] as const
/** A working agent, or a dedicated agent under a reserved object name. */
export const AGENT_KINDS = ['working', 'dedicated'] as const
/** Lifecycle states; docs/agents.md (Lifecycle) lists the planned moves. */
export const AGENT_STATUSES = [
  'provisioning',
  'active',
  'pausing',
  'paused',
  'archived',
  'deleting',
  'deleted',
] as const
/** The last step a purge finished; a stopped purge resumes after it. */
export const PURGE_STATES = ['management', 'memory', 'archive', 'object', 'done'] as const
/** Keys of `system_settings`. */
export const SYSTEM_SETTING_KEYS = ['install_id', 'reconcile_cursor', 'usage_sweep_cursor'] as const
/** What an audit row is about. */
export const AUDIT_TARGETS = ['agent', 'system'] as const

/** Handle of the management database. */
export type ManagementDb = D1Database

/** A registry row with narrowed enum fields. */
export interface AgentRow {
  agentId: string
  objectName: string
  kind: (typeof AGENT_KINDS)[number]
  displayName: string
  slug: string | null
  status: (typeof AGENT_STATUSES)[number]
  purgeState: (typeof PURGE_STATES)[number] | null
  currentVersion: number
  appliedVersion: number
  createdAt: number
  updatedAt: number
}

/** A configuration version row with narrowed enum fields. */
export interface VersionRow {
  agentId: string
  version: number
  settingsJson: string
  schemaVersion: number
  source: (typeof MANAGEMENT_SOURCES)[number]
  comment: string | null
  createdAt: number
}

/** Narrow a raw SQL registry row into an {@link AgentRow}. */
export function parseAgentRow(row: {
  agentId: string
  objectName: string
  kind: string
  displayName: string
  slug: string | null
  status: string
  purgeState: string | null
  currentVersion: number
  appliedVersion: number
  createdAt: number
  updatedAt: number
}): AgentRow {
  return {
    ...row,
    kind: parseEnum(AGENT_KINDS, row.kind, 'agent kind'),
    status: parseEnum(AGENT_STATUSES, row.status, 'agent status'),
    purgeState: parseNullableEnum(PURGE_STATES, row.purgeState, 'purge state'),
  }
}

/** Narrow a raw SQL version row into a {@link VersionRow}. */
export function parseVersionRow(row: {
  agentId: string
  version: number
  settingsJson: string
  schemaVersion: number
  source: string
  comment: string | null
  createdAt: number
}): VersionRow {
  return {
    ...row,
    source: parseEnum(MANAGEMENT_SOURCES, row.source, 'version source'),
  }
}

/** The management database on a D1 binding. */
export function managementDb(d1: D1Database): ManagementDb {
  return d1
}
