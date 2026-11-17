/**
 * The memory database: its D1 handle, record types, and scopes.
 *
 * @see docs/memory.md — D1 schema, Scopes
 *
 * @module
 */
import { parseEnum } from '../../lib/reylo.ts'

/** Whose a record is: one agent's (`agent:<id>`) or a shared space's (`shared:<space>`). */
export type Scope = `agent:${string}` | `shared:${string}`

/** What a record holds; only facts and instructions are always loaded. */
export const RECORD_KINDS = ['fact', 'event', 'instruction', 'task'] as const
/** Only `active` records are searched and loaded; the others are kept for the ledger. */
export const RECORD_STATUSES = ['active', 'superseded', 'invalid', 'archived'] as const
/** How a record came to be written. */
export const RECORD_ORIGINS = ['remember', 'extraction', 'consolidation', 'shared'] as const

/** A record's kind: `fact`, `instruction`, `event`, or `task`. */
export type RecordKind = (typeof RECORD_KINDS)[number]
/** A record's lifecycle status. */
export type RecordStatus = (typeof RECORD_STATUSES)[number]
/**
 * Where a record came from: a request, the agent's judgment, extraction, consolidation, or a shared write.
 */
export type RecordOrigin = (typeof RECORD_ORIGINS)[number]

/** Handle of the memory database. */
export type MemoryDb = D1Database

/** A memory record row with narrowed scope and enum fields. */
export interface MemoryRecord {
  id: string
  scope: Scope
  kind: RecordKind
  content: string
  searchVersion: number
  status: RecordStatus
  supersededBy: string | null
  origin: RecordOrigin
  sourceAgentId: string
  sourceEntryFrom: number | null
  sourceEntryTo: number | null
  runId: string
  importance: number
  pinned: boolean
  overrides: string | null
  required: boolean
  useCount: number
  lastUsedAt: number | null
  observedAt: number
  createdAt: number
  updatedAt: number
  revision: number
}

const SCOPE_PATTERN = /^(?:agent|shared):[a-zA-Z0-9_-]{1,64}$/

/** Whether `value` is `agent:<id>` or `shared:<space>`. */
export function isScope(value: unknown): value is Scope {
  return typeof value === 'string' && SCOPE_PATTERN.test(value)
}

/** Narrow a string read from SQLite into a validated {@link Scope}. */
export function parseScope(value: string): Scope {
  if (!isScope(value)) throw new TypeError(`Unexpected memory scope: ${value}`)
  return value
}

/** Narrow a raw SQL row from `memory_records` into a {@link MemoryRecord}. */
export function parseMemoryRecord(row: {
  id: string
  scope: string
  kind: string
  content: string
  searchVersion: number
  status: string
  supersededBy: string | null
  origin: string
  sourceAgentId: string
  sourceEntryFrom: number | null
  sourceEntryTo: number | null
  runId: string
  importance: number
  pinned: boolean
  overrides: string | null
  required: boolean
  useCount: number
  lastUsedAt: number | null
  observedAt: number
  createdAt: number
  updatedAt: number
  revision: number
}): MemoryRecord {
  return {
    ...row,
    scope: parseScope(row.scope),
    kind: parseEnum(RECORD_KINDS, row.kind, 'record kind'),
    status: parseEnum(RECORD_STATUSES, row.status, 'record status'),
    origin: parseEnum(RECORD_ORIGINS, row.origin, 'record origin'),
  }
}

/** The memory database on a D1 binding. */
export function memoryDb(d1: D1Database): MemoryDb {
  return d1
}

/** The scope of an agent's own memory. */
export function agentScope(agentId: string): Scope {
  return `agent:${agentId}`
}

/** The scopes an agent reads: its own first, then its shared spaces in order. */
export function readableScopes(agentId: string, sharedSpaces: readonly string[]): Scope[] {
  return [agentScope(agentId), ...sharedSpaces.map((space): Scope => `shared:${space}`)]
}
