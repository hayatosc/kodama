/**
 * The control database: its Drizzle handle and row types.
 *
 * @see docs/agents.md — Control database
 *
 * @module
 */
import * as schema from '../../drizzle/control/schema.ts'
import { drizzle } from 'drizzle-orm/d1'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import type { agentConfigVersions, agents, principals } from '../../drizzle/control/schema.ts'

/** Drizzle handle of the control database. */
export type ControlDb = DrizzleD1Database<typeof schema>
/** A registry row. */
export type AgentRow = typeof agents.$inferSelect
/** A configuration version row. */
export type VersionRow = typeof agentConfigVersions.$inferSelect
/** A principal row. */
export type PrincipalRow = typeof principals.$inferSelect

/** The control database on a D1 binding. */
export function controlDb(d1: D1Database): ControlDb {
  return drizzle(d1, { schema })
}
