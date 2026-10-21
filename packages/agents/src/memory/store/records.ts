/**
 * Memory records in D1: applying write operations
 * (docs/design/long-term-memory.md, Applying a write, Freshness).
 */
import { and, eq, lte } from 'drizzle-orm'
import type { MemoryDb, MemoryRecord, RecordKind, RecordOrigin } from './db.ts'
import { archiveSegments, extractionCheckpoints, memoryLedger, memoryRecords } from './schema.ts'
import type { Scope } from './schema.ts'
import { SEARCH_VERSION } from './search-text.ts'
import {
  appliedResult,
  bumpScope,
  claimRevision,
  errorText,
  insertOp,
  termStatements,
} from './statements.ts'
import type { OperationContext, OperationResult, Statement, Statements } from './statements.ts'

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
