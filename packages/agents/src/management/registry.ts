/**
 * The agent registry: reading rows, admitting public calls, and resolving what a person types.
 *
 * @see docs/agents.md — Registry and admission
 *
 * @module
 */
import { and, desc, eq, like } from 'drizzle-orm'
import { agents } from '../../drizzle/management/schema.ts'
import { isUuid } from '../lib/uuid.ts'
import type { AgentStatus, AgentSummary } from '../protocol.ts'
import type { AgentRow, ManagementDb } from './db.ts'
import { ADMITTED_STATUSES } from './lifecycle.ts'
import type { AgentUse } from './lifecycle.ts'

/**
 * The registry row of `agentId`.
 *
 * @throws {@link TypeError} When the registry has no such agent.
 */
export async function agentRow(db: ManagementDb, agentId: string): Promise<AgentRow> {
  const row = await db.select().from(agents).where(eq(agents.agentId, agentId)).get()
  if (row === undefined) throw new TypeError(`Unknown agent: ${agentId}`)
  return row
}

/** The registry row of the object named `objectName`, if it has one. */
export function agentRowByObjectName(db: ManagementDb, objectName: string) {
  return db.select().from(agents).where(eq(agents.objectName, objectName)).get()
}

/** A registry row as `AgentService` returns it. */
export function summaryOf(row: AgentRow): AgentSummary {
  return {
    agentId: row.agentId,
    kind: row.kind,
    displayName: row.displayName,
    ...(row.slug === null ? {} : { slug: row.slug }),
    status: row.status,
    desiredVersion: row.currentVersion,
    appliedVersion: row.appliedVersion,
    pending: row.appliedVersion < row.currentVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * The object name of a working agent the registry admits for `use`. It reads the registry on every
 * call, right before the object is reached, so an unknown ID never creates an object.
 *
 * @throws {@link TypeError} When the registry has no working agent with this ID.
 * @throws {@link Error} Starting `agent_unavailable:`, when the agent's state does not allow `use`.
 */
export async function admitAgent(
  db: ManagementDb,
  agentId: string,
  use: AgentUse,
): Promise<string> {
  const row = await db
    .select({ objectName: agents.objectName, kind: agents.kind, status: agents.status })
    .from(agents)
    .where(eq(agents.agentId, agentId))
    .get()
  if (row === undefined || row.kind !== 'working') throw new TypeError(`Unknown agent: ${agentId}`)
  if (!ADMITTED_STATUSES[use].includes(row.status)) {
    throw new Error(`agent_unavailable: ${agentId} is ${row.status}`)
  }
  return row.objectName
}

/** The shortest UUID prefix accepted, so a short slug is never read as a prefix by accident. */
const MIN_PREFIX_LENGTH = 4
/** Candidates listed in an ambiguous-prefix error. */
const MAX_CANDIDATES = 10

/**
 * The registry row a person named: a full UUID, then a slug, then a unique UUID prefix.
 *
 * @throws {@link TypeError} When nothing matches, or a prefix matches several agents (the message
 * lists them).
 */
export async function resolveAgentRef(db: ManagementDb, ref: string): Promise<AgentRow> {
  if (isUuid(ref)) return agentRow(db, ref)
  const bySlug = await db.select().from(agents).where(eq(agents.slug, ref)).get()
  if (bySlug !== undefined) return bySlug
  if (ref.length < MIN_PREFIX_LENGTH || !/^[0-9a-f-]+$/.test(ref)) {
    throw new TypeError(`Unknown agent: ${ref}`)
  }
  const matches = await db
    .select()
    .from(agents)
    .where(like(agents.agentId, `${ref}%`))
    .orderBy(agents.agentId)
    .limit(MAX_CANDIDATES + 1)
  const [first, ...others] = matches
  if (first === undefined) throw new TypeError(`Unknown agent: ${ref}`)
  if (others.length > 0) {
    const candidates = matches.slice(0, MAX_CANDIDATES).map((row) => row.agentId)
    throw new TypeError(`Ambiguous agent prefix ${ref}; candidates: ${candidates.join(', ')}`)
  }
  return first
}

/** Registry rows, newest first, optionally of one kind or state. */
export function listAgentRows(
  db: ManagementDb,
  filter: { kind?: AgentRow['kind']; status?: AgentStatus },
): Promise<AgentRow[]> {
  const conditions = [
    filter.kind === undefined ? undefined : eq(agents.kind, filter.kind),
    filter.status === undefined ? undefined : eq(agents.status, filter.status),
  ]
  return db
    .select()
    .from(agents)
    .where(and(...conditions))
    .orderBy(desc(agents.createdAt), desc(agents.agentId))
}
