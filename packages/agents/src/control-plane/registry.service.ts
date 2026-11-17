/**
 * The agent registry service: reading rows, admitting public calls, and resolving what a person types.
 *
 * @see docs/agents.md — Registry and admission
 *
 * @module
 */
import * as v from 'valibot'
import { isUuid } from '../lib/uuid.ts'
import type { AgentStatus, AgentSummary } from '../protocol.ts'
import type { AgentRow, ManagementDb } from './db.ts'
import { ADMITTED_STATUSES } from './lifecycle.ts'
import type { AgentUse } from './lifecycle.ts'
import {
  findAgentById,
  findAgentByObjectName,
  findAgentBySlug,
  listAgentsByPrefix,
  listDiscoverAgentRows,
  listRegistryAgents,
} from './registry.repository.ts'

/**
 * The registry row of `agentId`.
 *
 * @throws {@link TypeError} When the registry has no such agent.
 */
export async function agentRow(db: ManagementDb, agentId: string): Promise<AgentRow> {
  const row = await findAgentById(db, agentId)
  if (row === undefined) throw new TypeError(`Unknown agent: ${agentId}`)
  return row
}

/** The registry row of the object named `objectName`, if it has one. */
export async function agentRowByObjectName(
  db: ManagementDb,
  objectName: string,
): Promise<AgentRow | undefined> {
  return findAgentByObjectName(db, objectName)
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
  const row = await findAgentById(db, agentId)
  if (row === undefined) throw new TypeError(`Unknown agent: ${agentId}`)
  if (row.kind !== 'working') throw new TypeError(`Unknown agent: ${agentId}`)
  if (!ADMITTED_STATUSES[use].includes(row.status)) {
    throw new Error(`agent_unavailable: ${agentId} is ${row.status}`)
  }
  return row.objectName
}

/** The shortest UUID prefix accepted, so a short slug is never read as a prefix by accident. */
const MIN_PREFIX_LENGTH = 4
/** Candidates listed in an ambiguous-prefix error. */
const MAX_CANDIDATES = 10

async function prefixMatches(db: ManagementDb, prefix: string): Promise<AgentRow[]> {
  return listAgentsByPrefix(db, `${prefix}%`, MAX_CANDIDATES + 1)
}

function ambiguous(ref: string, rows: readonly AgentRow[]): TypeError {
  const candidates = rows.slice(0, MAX_CANDIDATES).map((row) => row.agentId)
  return new TypeError(`Ambiguous agent prefix ${ref}; candidates: ${candidates.join(', ')}`)
}

/**
 * The registry row a person named: a full UUID, then a slug, then a unique UUID prefix.
 *
 * @remarks
 * A slug of hex digits can also read as a UUID prefix. When it is the prefix of another agent,
 * the reference is ambiguous rather than silently the slug's agent, so renaming an agent cannot
 * capture messages addressed to another one by prefix.
 *
 * @throws {@link TypeError} When nothing matches, or a reference matches several agents (the
 * message lists them).
 */
export async function resolveAgentRef(db: ManagementDb, ref: string): Promise<AgentRow> {
  if (isUuid(ref)) return agentRow(db, ref)
  const bySlug = await findAgentBySlug(db, ref)
  const prefix = ref.length >= MIN_PREFIX_LENGTH && /^[0-9a-f-]+$/.test(ref)
  const matches = prefix ? await prefixMatches(db, ref) : []
  if (bySlug !== undefined) {
    const others = matches.filter((row) => row.agentId !== bySlug.agentId)
    if (others.length > 0) throw ambiguous(ref, [bySlug, ...others])
    return bySlug
  }
  const [first, ...others] = matches
  if (first === undefined) throw new TypeError(`Unknown agent: ${ref}`)
  if (others.length > 0) throw ambiguous(ref, matches)
  return first
}

/** Bounded discovery exposes only an allowlisted projection of public configuration metadata. */
export async function discoverAgents(
  db: ManagementDb,
  filter: { query?: string; label?: string; cursor?: string },
) {
  const rows = await listDiscoverAgentRows(db, filter.cursor || null)
  const query = filter.query?.toLowerCase()
  const found = rows
    .slice(0, 50)
    .map((row) => {
      const metadata = v.parse(
        v.object({
          description: v.optional(v.string(), ''),
          labels: v.optional(v.array(v.string()), []),
        }),
        JSON.parse(row.settingsJson),
      )
      return { agentId: row.agentId, displayName: row.displayName, slug: row.slug, ...metadata }
    })
    .filter(
      (row) =>
        (!filter.label || row.labels.includes(filter.label)) &&
        (!query ||
          `${row.displayName}\n${row.slug ?? ''}\n${row.description}`
            .toLowerCase()
            .includes(query)),
    )
  return { agents: found, nextCursor: rows.length > 50 ? rows[49]?.agentId : undefined }
}

/** Registry rows, newest first, optionally of one kind or state. */
export async function listAgentRows(
  db: ManagementDb,
  filter: { kind?: AgentRow['kind']; status?: AgentStatus },
): Promise<AgentRow[]> {
  return listRegistryAgents(db, filter)
}
