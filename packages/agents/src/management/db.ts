/**
 * The management database: its Drizzle handle and row types.
 *
 * @see docs/agents.md — Management database
 *
 * @module
 */
import * as schema from '../../drizzle/management/schema.ts'
import { drizzle } from 'drizzle-orm/d1'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import type { agentConfigVersions, agents, principals } from '../../drizzle/management/schema.ts'

/** Drizzle handle of the management database. */
export type ManagementDb = DrizzleD1Database<typeof schema>
/** A registry row. */
export type AgentRow = typeof agents.$inferSelect
/** A configuration version row. */
export type VersionRow = typeof agentConfigVersions.$inferSelect
/** A principal row. */
export type PrincipalRow = typeof principals.$inferSelect

/** The management database on a D1 binding. */
export function managementDb(d1: D1Database): ManagementDb {
  return drizzle(d1, { schema })
}
