/**
 * Plans of the operations that write, supersede, or invalidate memory records.
 *
 * @see docs/memory.md — Applying a write
 *
 * @module
 */
import { and, eq } from 'drizzle-orm'
import type { MemoryDb, MemoryRecord, RecordKind } from './db.ts'
import type { NewRecord, Operation, RecordEvidence } from './records.ts'
import { memoryRecords } from '../../../drizzle/memory/schema.ts'
import { SEARCH_VERSION } from '../../lib/search-text.ts'
import {
  bumpScope,
  claimRevision,
  conflict,
  insertOp,
  recordLedger,
  termStatements,
} from './statements.ts'
import type {
  OperationContext,
  OperationResult,
  Plan,
  Statement,
  Statements,
} from './statements.ts'
import { sha256Hex } from '../../lib/hash.ts'

/**
 * A record's ID: a hash of its scope, kind, content, source agent, and first source entry.
 *
 * @remarks
 * The same content from the same source gets the same ID, so a second insert fails.
 */
export function recordId(record: NewRecord): Promise<string> {
  return sha256Hex(
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
function isStale(old: MemoryRecord, record: RecordEvidence): boolean {
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

/**
 * Plan a new record.
 *
 * @throws {@link TypeError} When the record breaks a rule the columns cannot express.
 */
export async function planWrite(
  db: MemoryDb,
  context: OperationContext,
  op: Extract<Operation, { type: 'write' }>,
): Promise<Plan> {
  const id = await recordId(op.record)
  const result: OperationResult = { status: 'applied', recordId: id }
  const statements: Statements = [
    insertOp(db, context, op.type, result),
    ...insertRecord(db, context, id, op.record),
    recordLedger(db, context, 'write', id, { origin: op.record.origin }),
  ]
  if (affectsAlwaysLoaded(op.record.kind)) {
    statements.push(bumpScope(db, context, op.record.scope))
  }
  return { result, statements }
}

/**
 * Plan replacing an active record, named by ID at the revision the writer read.
 *
 * @returns A `conflict` plan when the record changed or is of another scope or agent, and a
 * `stale` plan when the candidate rests on older entries than the record.
 */
export async function planSupersede(
  db: MemoryDb,
  context: OperationContext,
  op: Extract<Operation, { type: 'supersede' }>,
): Promise<Plan> {
  const old = await readRecord(db, op.oldId)
  if (old === undefined || old.status !== 'active' || old.revision !== op.oldRevision) {
    return conflict(db, context, op.oldId, 'target_changed')
  }
  if (old.scope !== op.record.scope) return conflict(db, context, op.oldId, 'other_scope')
  if (old.sourceAgentId !== op.record.sourceAgentId) {
    return conflict(db, context, op.oldId, 'other_agent')
  }
  // Consolidation reorganizes existing records, and a shared write rests on agents' records;
  // neither brings newer evidence of the record's own source.
  const reorganizes = op.record.origin === 'consolidation' || op.record.origin === 'shared'
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
        recordLedger(db, context, 'decline_stale', op.oldId, { content: op.record.content }),
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
    recordLedger(db, context, 'supersede', id, { replaces: op.oldId }),
  ]
  if (affectsAlwaysLoaded(record.kind) || affectsAlwaysLoaded(old.kind)) {
    statements.push(bumpScope(db, context, record.scope))
  }
  return { result, statements }
}

/** Plan marking an active record as no longer true, at the revision the writer read. */
export async function planInvalidate(
  db: MemoryDb,
  context: OperationContext,
  op: Extract<Operation, { type: 'invalidate' }>,
): Promise<Plan> {
  const old = await readRecord(db, op.id)
  if (old === undefined || old.status !== 'active' || old.revision !== op.revision) {
    return conflict(db, context, op.id, 'target_changed')
  }
  if (old.scope !== op.evidence.scope) return conflict(db, context, op.id, 'other_scope')
  if (old.sourceAgentId !== op.evidence.sourceAgentId) {
    return conflict(db, context, op.id, 'other_agent')
  }
  if (op.evidence.origin !== 'consolidation' && isStale(old, op.evidence)) {
    const result: OperationResult = { status: 'stale' }
    return {
      result,
      statements: [
        insertOp(db, context, op.type, result),
        recordLedger(db, context, 'decline_stale', op.id, { reason: op.reason }),
      ],
    }
  }
  const result: OperationResult = { status: 'applied', recordId: op.id }
  const statements: Statements = [
    insertOp(db, context, op.type, result),
    ...guardedStatusUpdate(db, context, op.id, op.revision, { status: 'invalid' }),
    recordLedger(db, context, 'invalidate', op.id, { reason: op.reason }),
  ]
  if (affectsAlwaysLoaded(old.kind)) statements.push(bumpScope(db, context, old.scope))
  return { result, statements }
}
