/**
 * Memory records in D1: applying write operations and searching
 * (docs/design/long-term-memory.md, Applying a write, Freshness, Queries).
 */
import { and, eq, gte, inArray, lt, lte } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { drizzle } from 'drizzle-orm/d1'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import * as v from 'valibot'
import * as schema from './schema.ts'
import {
  archiveSegments,
  extractionCheckpoints,
  memoryLedger,
  memoryOps,
  memoryRecords,
  memoryTerms,
  revisionClaims,
  scopeRevisions,
} from './schema.ts'
import type { Scope } from './schema.ts'
import { SEARCH_VERSION, searchTermSets, storedTerms } from './search-text.ts'

export type { Scope } from './schema.ts'
export type MemoryDb = DrizzleD1Database<typeof schema>
export type MemoryRecord = typeof memoryRecords.$inferSelect
export type RecordKind = MemoryRecord['kind']
export type RecordOrigin = MemoryRecord['origin']

export function memoryDb(d1: D1Database): MemoryDb {
  return drizzle(d1, { schema })
}

/** The extraction checkpoint of an agent: the last entry extraction has covered, or 0. */
export async function extractionCheckpoint(db: MemoryDb, agentId: string): Promise<number> {
  const row = await db
    .select({ lastEntryId: extractionCheckpoints.lastEntryId })
    .from(extractionCheckpoints)
    .where(eq(extractionCheckpoints.agentId, agentId))
    .get()
  return row?.lastEntryId ?? 0
}

export interface NewRecord {
  scope: Scope
  kind: RecordKind
  content: string
  origin: RecordOrigin
  sourceAgentId: string
  /** Inclusive range of the entries of the source agent that the record rests on. */
  sourceEntries?: { from: number; to: number }
  /** 0 to 1; defaults to 0.5. */
  importance?: number
  /** For an agent record: the ID of the shared record it replaces for this agent. */
  overrides?: string
  /** For a shared fact or instruction that agent records cannot override. */
  required?: boolean
  observedAt: number
}

export type Operation =
  | { type: 'write'; record: NewRecord }
  /** Replace an active record of the same scope, named by ID at the revision the writer read. */
  | { type: 'supersede'; oldId: string; oldRevision: number; record: NewRecord }
  | { type: 'invalidate'; id: string; revision: number; reason: string }
  /** Keep a declined candidate in the ledger only. */
  | { type: 'decline'; candidate: string; reason: string }
  /** Record that extraction has covered an agent's entries through `lastEntryId`. */
  | { type: 'checkpoint'; agentId: string; lastEntryId: number }
  /** Record that the summary of an archived segment is in R2. */
  | { type: 'archive_summary'; segmentId: string }

/** `stale`: the candidate is older than the record it would replace, so it was declined. */
export type OperationResult =
  | { status: 'applied'; recordId: string }
  | { status: 'declined' }
  | { status: 'stale' }
  | { status: 'conflict'; reason: string }

export interface OperationContext {
  /** Same for every attempt of one change, for example derived from the job and tool call IDs. */
  opId: string
  jobId: string
  runId: string
  actor: string
  now: number
  /** Test hook that runs between the precondition read and the batch. */
  beforeBatch?: () => Promise<void>
}

const operationResultSchema = v.variant('status', [
  v.object({ status: v.literal('applied'), recordId: v.string() }),
  v.object({ status: v.literal('declined') }),
  v.object({ status: v.literal('stale') }),
  v.object({ status: v.literal('conflict'), reason: v.string() }),
])

type Statement = BatchItem<'sqlite'>
type Statements = [Statement, ...Statement[]]
type Plan = { result: OperationResult; statements: Statements }

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Same content from the same source gets the same ID, so a second insert fails. */
export function recordId(record: NewRecord): Promise<string> {
  return sha256(
    JSON.stringify([
      record.scope,
      record.kind,
      record.content,
      record.sourceAgentId,
      record.sourceEntries?.from ?? null,
    ]),
  )
}

/** Instructions and facts are always loaded, so a change to them changes the scope's revision. */
function affectsAlwaysLoaded(kind: RecordKind): boolean {
  return kind === 'fact' || kind === 'instruction'
}

/** Rejects a candidate built on older evidence than the record it would replace. */
function isStale(old: MemoryRecord, record: NewRecord): boolean {
  const newer = record.sourceEntries?.to
  return newer === undefined || (old.sourceEntryTo !== null && newer <= old.sourceEntryTo)
}

/** Messages of an error and its causes; Drizzle wraps the D1 error in `cause`. */
function errorText(error: unknown): string {
  const parts: string[] = []
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    parts.push(current.message)
  }
  return parts.join('\n')
}

/** Rules the typed columns cannot express; a record that breaks one is a bug in the caller. */
function validateRecord(record: NewRecord): void {
  if (record.content.length === 0 || record.content.length > 2_000) {
    throw new TypeError('A record has 1–2000 characters')
  }
  const importance = record.importance ?? 0.5
  if (importance < 0 || importance > 1) throw new TypeError('importance is between 0 and 1')
  if (record.overrides !== undefined && !record.scope.startsWith('agent:')) {
    throw new TypeError('Only an agent record overrides a shared record')
  }
  if (
    record.required === true &&
    !(
      record.scope.startsWith('shared:') &&
      (record.kind === 'fact' || record.kind === 'instruction')
    )
  ) {
    throw new TypeError('Only a shared fact or instruction is required')
  }
}

/** D1 binds at most 100 parameters per statement; a term row takes two. */
const TERMS_PER_STATEMENT = 50

/** Inserts of a record's search terms, in statements D1 accepts. */
export function termStatements(db: MemoryDb, recordId: string, content: string): Statement[] {
  const rows = storedTerms(content).map((term) => ({ term, recordId }))
  const statements: Statement[] = []
  for (let start = 0; start < rows.length; start += TERMS_PER_STATEMENT) {
    statements.push(db.insert(memoryTerms).values(rows.slice(start, start + TERMS_PER_STATEMENT)))
  }
  return statements
}

/** The record row and its search terms. */
function insertRecord(
  db: MemoryDb,
  context: OperationContext,
  id: string,
  record: NewRecord,
): Statement[] {
  validateRecord(record)
  const row = db.insert(memoryRecords).values({
    id,
    scope: record.scope,
    kind: record.kind,
    content: record.content,
    searchVersion: SEARCH_VERSION,
    origin: record.origin,
    sourceAgentId: record.sourceAgentId,
    sourceEntryFrom: record.sourceEntries?.from,
    sourceEntryTo: record.sourceEntries?.to,
    runId: context.runId,
    importance: record.importance,
    required: record.required,
    overrides: record.overrides,
    observedAt: record.observedAt,
    createdAt: context.now,
    updatedAt: context.now,
  })
  return [row, ...termStatements(db, id, record.content)]
}

export function insertOp(
  db: MemoryDb,
  context: OperationContext,
  op: string,
  result: OperationResult,
) {
  return db.insert(memoryOps).values({
    opId: context.opId,
    jobId: context.jobId,
    op,
    resultJson: JSON.stringify(result),
    appliedAt: context.now,
  })
}

/**
 * Claim the revision a change moves its target to. With the update guarded by the revision it
 * read, a second writer from that revision fails here and its whole batch rolls back.
 */
export function claimRevision(
  db: MemoryDb,
  context: OperationContext,
  target: 'record' | 'checkpoint' | 'skill',
  targetId: string,
  revision: number,
) {
  return db
    .insert(revisionClaims)
    .values({ target, targetId, revision, opId: context.opId, claimedAt: context.now })
}

/** A new value each time; scope revisions are compared for equality only. */
function newScopeRevision(): number {
  const [high = 0, low = 0] = crypto.getRandomValues(new Uint32Array(2))
  return high * 2 ** 20 + (low >>> 12)
}

function ledger(
  db: MemoryDb,
  context: OperationContext,
  action: string,
  targetId: string,
  detail: unknown,
) {
  return db.insert(memoryLedger).values({
    at: context.now,
    runId: context.runId,
    opId: context.opId,
    actor: context.actor,
    action,
    target: 'record',
    targetId,
    detailJson: JSON.stringify(detail),
  })
}

export function bumpScope(db: MemoryDb, context: OperationContext, scope: Scope) {
  const revision = newScopeRevision()
  return db
    .insert(scopeRevisions)
    .values({ scope, revision, updatedAt: context.now })
    .onConflictDoUpdate({ target: scopeRevisions.scope, set: { revision, updatedAt: context.now } })
}

/** Move an active record at `revision` to `status`, claiming the next revision. */
function guardedStatusUpdate(
  db: MemoryDb,
  context: OperationContext,
  id: string,
  revision: number,
  change: { status: 'superseded'; supersededBy: string } | { status: 'invalid' },
): Statement[] {
  return [
    db
      .update(memoryRecords)
      .set({ ...change, revision: revision + 1, updatedAt: context.now })
      .where(
        and(
          eq(memoryRecords.id, id),
          eq(memoryRecords.status, 'active'),
          eq(memoryRecords.revision, revision),
        ),
      ),
    claimRevision(db, context, 'record', id, revision + 1),
  ]
}

function readRecord(db: MemoryDb, id: string): Promise<MemoryRecord | undefined> {
  return db.select().from(memoryRecords).where(eq(memoryRecords.id, id)).get()
}

export async function appliedResult(
  db: MemoryDb,
  opId: string,
): Promise<OperationResult | undefined> {
  const row = await db
    .select({ resultJson: memoryOps.resultJson })
    .from(memoryOps)
    .where(eq(memoryOps.opId, opId))
    .get()
  if (row === undefined) return undefined
  const parsed: unknown = JSON.parse(row.resultJson)
  return v.parse(operationResultSchema, parsed)
}

/** A conflict changes nothing but is logged, so the candidate can be evaluated again later. */
function conflict(db: MemoryDb, context: OperationContext, targetId: string, reason: string): Plan {
  return {
    result: { status: 'conflict', reason },
    statements: [ledger(db, context, 'conflict', targetId, { reason })],
  }
}

async function plan(db: MemoryDb, context: OperationContext, op: Operation): Promise<Plan> {
  switch (op.type) {
    case 'write': {
      const id = await recordId(op.record)
      const result: OperationResult = { status: 'applied', recordId: id }
      const statements: Statements = [
        insertOp(db, context, op.type, result),
        ...insertRecord(db, context, id, op.record),
        ledger(db, context, 'write', id, { origin: op.record.origin }),
      ]
      if (affectsAlwaysLoaded(op.record.kind)) {
        statements.push(bumpScope(db, context, op.record.scope))
      }
      return { result, statements }
    }
    case 'supersede': {
      const old = await readRecord(db, op.oldId)
      if (old === undefined || old.status !== 'active' || old.revision !== op.oldRevision) {
        return conflict(db, context, op.oldId, 'target_changed')
      }
      if (old.scope !== op.record.scope) return conflict(db, context, op.oldId, 'other_scope')
      if (old.sourceAgentId !== op.record.sourceAgentId) {
        return conflict(db, context, op.oldId, 'other_agent')
      }
      // Consolidation reorganizes existing records, and a proposal is applied as it was checked;
      // neither brings newer evidence.
      const reorganizes = op.record.origin === 'consolidation' || op.record.origin === 'proposal'
      const record: NewRecord =
        reorganizes && op.record.sourceEntries === undefined && old.sourceEntryTo !== null
          ? {
              ...op.record,
              sourceEntries: {
                from: old.sourceEntryFrom ?? old.sourceEntryTo,
                to: old.sourceEntryTo,
              },
            }
          : op.record
      if (!reorganizes && isStale(old, record)) {
        const result: OperationResult = { status: 'stale' }
        return {
          result,
          statements: [
            insertOp(db, context, op.type, result),
            ledger(db, context, 'decline_stale', op.oldId, { content: op.record.content }),
          ],
        }
      }
      const id = await recordId(record)
      const result: OperationResult = { status: 'applied', recordId: id }
      const statements: Statements = [
        insertOp(db, context, op.type, result),
        ...guardedStatusUpdate(db, context, op.oldId, op.oldRevision, {
          status: 'superseded',
          supersededBy: id,
        }),
        ...insertRecord(db, context, id, record),
        ledger(db, context, 'supersede', id, { replaces: op.oldId }),
      ]
      if (affectsAlwaysLoaded(record.kind) || affectsAlwaysLoaded(old.kind)) {
        statements.push(bumpScope(db, context, record.scope))
      }
      return { result, statements }
    }
    case 'invalidate': {
      const old = await readRecord(db, op.id)
      if (old === undefined || old.status !== 'active' || old.revision !== op.revision) {
        return conflict(db, context, op.id, 'target_changed')
      }
      const result: OperationResult = { status: 'applied', recordId: op.id }
      const statements: Statements = [
        insertOp(db, context, op.type, result),
        ...guardedStatusUpdate(db, context, op.id, op.revision, { status: 'invalid' }),
        ledger(db, context, 'invalidate', op.id, { reason: op.reason }),
      ]
      if (affectsAlwaysLoaded(old.kind)) statements.push(bumpScope(db, context, old.scope))
      return { result, statements }
    }
    case 'checkpoint': {
      const current = await db
        .select()
        .from(extractionCheckpoints)
        .where(eq(extractionCheckpoints.agentId, op.agentId))
        .get()
      const result: OperationResult = { status: 'applied', recordId: op.agentId }
      if (current !== undefined && current.lastEntryId >= op.lastEntryId) {
        return { result, statements: [insertOp(db, context, op.type, result)] }
      }
      const advance: Statement[] =
        current === undefined
          ? [
              db.insert(extractionCheckpoints).values({
                agentId: op.agentId,
                lastEntryId: op.lastEntryId,
                updatedAt: context.now,
              }),
            ]
          : [
              db
                .update(extractionCheckpoints)
                .set({
                  lastEntryId: op.lastEntryId,
                  revision: current.revision + 1,
                  updatedAt: context.now,
                })
                .where(
                  and(
                    eq(extractionCheckpoints.agentId, op.agentId),
                    eq(extractionCheckpoints.revision, current.revision),
                  ),
                ),
              claimRevision(db, context, 'checkpoint', op.agentId, current.revision + 1),
            ]
      return {
        result,
        statements: [
          insertOp(db, context, op.type, result),
          ...advance,
          db
            .update(archiveSegments)
            .set({ extracted: true })
            .where(
              and(
                eq(archiveSegments.agentId, op.agentId),
                lte(archiveSegments.lastEntry, op.lastEntryId),
              ),
            ),
        ],
      }
    }
    case 'archive_summary': {
      const segment = await db
        .select({ id: archiveSegments.id })
        .from(archiveSegments)
        .where(eq(archiveSegments.id, op.segmentId))
        .get()
      if (segment === undefined) return conflict(db, context, op.segmentId, 'missing_segment')
      const result: OperationResult = { status: 'applied', recordId: op.segmentId }
      return {
        result,
        statements: [
          insertOp(db, context, op.type, result),
          // Segments are never removed while memory runs, so the row read above is still there.
          db
            .update(archiveSegments)
            .set({ hasSummary: true })
            .where(eq(archiveSegments.id, op.segmentId)),
        ],
      }
    }
    case 'decline': {
      const result: OperationResult = { status: 'declined' }
      return {
        result,
        statements: [
          insertOp(db, context, op.type, result),
          ledger(db, context, 'decline', '', { candidate: op.candidate, reason: op.reason }),
        ],
      }
    }
  }
}

/**
 * Apply one operation at most once. A repeat with the same `opId` returns the first result and
 * changes nothing; a broken precondition returns `conflict` and changes nothing.
 */
export async function applyOperation(
  db: MemoryDb,
  context: OperationContext,
  op: Operation,
): Promise<OperationResult & { replayed: boolean }> {
  const earlier = await appliedResult(db, context.opId)
  if (earlier !== undefined) return { ...earlier, replayed: true }

  const { result, statements } = await plan(db, context, op)
  await context.beforeBatch?.()
  try {
    await db.batch(statements)
  } catch (error) {
    const text = errorText(error)
    if (!/constraint/i.test(text)) throw error
    // Another attempt applied the same operation first, or a target changed after the read.
    const applied = await appliedResult(db, context.opId)
    if (applied !== undefined) return { ...applied, replayed: true }
    const reason = /memory_records\.id/.test(text) ? 'duplicate' : 'changed_during_write'
    return { status: 'conflict', reason, replayed: false }
  }
  return { ...result, replayed: false }
}

export interface SearchOptions {
  query: string
  scopes: readonly Scope[]
  now: number
  /** Defaults to 10. */
  limit?: number
  /** Count the returned records as used; the memory agent's own lookups do not. Default true. */
  countUse?: boolean
}

const EVENT_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000

/** Higher is better: importance, use, and for events, recency. */
function score(record: MemoryRecord, now: number): number {
  const age = Math.max(0, now - record.observedAt)
  const recency = record.kind === 'event' ? 0.5 ** (age / EVENT_HALF_LIFE_MS) : 1
  return (0.5 + record.importance) * recency * (1 + Math.log1p(record.useCount) / 10)
}

/** Candidates per query word, enough for a scope of a few thousand records. */
const CANDIDATES_PER_WORD = 500

/** Active records of the scopes that have `term`, or a term starting with it. */
async function recordsWithTerm(
  db: MemoryDb,
  term: string,
  prefix: boolean,
  scopes: readonly Scope[],
): Promise<Set<string>> {
  const rows = await db
    .select({ id: memoryTerms.recordId })
    .from(memoryTerms)
    .innerJoin(memoryRecords, eq(memoryRecords.id, memoryTerms.recordId))
    .where(
      and(
        // A prefix is the range of terms from it up to the next possible string.
        prefix
          ? and(gte(memoryTerms.term, term), lt(memoryTerms.term, `${term}\u{10FFFF}`))
          : eq(memoryTerms.term, term),
        eq(memoryRecords.status, 'active'),
        inArray(memoryRecords.scope, [...scopes]),
      ),
    )
    .limit(CANDIDATES_PER_WORD)
  return new Set(rows.map((row) => row.id))
}

/**
 * Search active records of the given scopes for every word of the query: merged words, then the
 * original segments, then merged words as prefixes. Ranked by importance, use, and for events
 * recency. Returned records count as used.
 */
export async function searchMemory(
  db: MemoryDb,
  { query, scopes, now, limit = 10, countUse = true }: SearchOptions,
): Promise<MemoryRecord[]> {
  if (scopes.length === 0) return []
  for (const { terms, prefix } of searchTermSets(query)) {
    let matches: Set<string> | undefined
    for (const term of terms) {
      const found = await recordsWithTerm(db, term, prefix, scopes)
      matches = matches === undefined ? found : new Set([...matches].filter((id) => found.has(id)))
      if (matches.size === 0) break
    }
    if (matches === undefined || matches.size === 0) continue
    const records = await db
      .select()
      .from(memoryRecords)
      .where(inArray(memoryRecords.id, [...matches].slice(0, CANDIDATES_PER_WORD)))
    const ranked = records
      .map((record) => ({ record, score: score(record, now) }))
      .sort((a, b) => b.score - a.score || b.record.updatedAt - a.record.updatedAt)
      .slice(0, limit)
      .map(({ record }) => record)
    if (countUse) await countUses(db, ranked, now)
    return ranked
  }
  return []
}

/** One more use of each record; a use counted twice at the same moment may be lost, which is fine. */
async function countUses(db: MemoryDb, records: readonly MemoryRecord[], now: number) {
  const [first, ...rest] = records.map((record) =>
    db
      .update(memoryRecords)
      .set({ useCount: record.useCount + 1, lastUsedAt: now })
      .where(eq(memoryRecords.id, record.id)),
  )
  if (first !== undefined) await db.batch([first, ...rest])
}
