/**
 * The D1 schema of long-term memory (docs/memory.md, D1 schema): one file for the one database.
 * `pnpm db:generate` turns this file into the migrations in ./migrations.
 * Times are Unix epoch milliseconds. Writes use plain inserts, never `INSERT OR IGNORE`: a
 * constraint violation must fail the statement so that the whole `batch()` rolls back. Allowed
 * values are the typed columns and the code that writes them; the constraints here are keys and
 * relations between columns.
 */
import { isNotNull, lte } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core'

// Records, their search terms, operations, revisions, checkpoints, and the ledger.

export type Scope = `agent:${string}` | `shared:${string}`
export const RECORD_KINDS = ['fact', 'event', 'instruction', 'task'] as const
export const RECORD_STATUSES = ['active', 'superseded', 'invalid', 'archived'] as const
export const RECORD_ORIGINS = [
  'user_request',
  'agent_judgment',
  'extraction',
  'consolidation',
  'shared',
] as const

export const memoryRecords = sqliteTable(
  'memory_records',
  {
    id: text('id').primaryKey(),
    scope: text('scope').$type<Scope>().notNull(),
    kind: text('kind', { enum: RECORD_KINDS }).notNull(),
    content: text('content').notNull(),
    /** Version of the search-text function that built the record's `memory_terms`. */
    searchVersion: integer('search_version').notNull(),
    status: text('status', { enum: RECORD_STATUSES }).notNull().default('active'),
    supersededBy: text('superseded_by'),
    origin: text('origin', { enum: RECORD_ORIGINS }).notNull(),
    sourceAgentId: text('source_agent_id').notNull(),
    /** Inclusive range of source entries; `sourceEntryTo` orders evidence (Freshness). */
    sourceEntryFrom: integer('source_entry_from'),
    sourceEntryTo: integer('source_entry_to'),
    runId: text('run_id').notNull(),
    importance: real('importance').notNull().default(0.5),
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    /** For an agent record: the ID of a shared record it replaces for this agent. */
    overrides: text('overrides'),
    /** A shared instruction or fact that agent records cannot override. */
    required: integer('required', { mode: 'boolean' }).notNull().default(false),
    /** Updated by working agents; never changes `revision`. */
    useCount: integer('use_count').notNull().default(0),
    lastUsedAt: integer('last_used_at'),
    observedAt: integer('observed_at').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    /** Incremented on every status or content change; writes compare it with what they read. */
    revision: integer('revision').notNull().default(1),
  },
  (t) => [
    index('memory_records_by_scope').on(t.scope, t.status, t.kind, t.importance),
    index('memory_records_by_source').on(t.sourceAgentId, t.sourceEntryFrom),
    index('memory_records_by_override').on(t.overrides).where(isNotNull(t.overrides)),
  ],
)

/**
 * One row per applied write operation, inserted by the batch that applies it, so a replay finds
 * it and returns `resultJson` without touching any record.
 */
export const memoryOps = sqliteTable(
  'memory_ops',
  {
    opId: text('op_id').primaryKey(),
    jobId: text('job_id').notNull(),
    op: text('op').notNull(),
    resultJson: text('result_json').notNull(),
    appliedAt: integer('applied_at').notNull(),
  },
  (t) => [index('memory_ops_by_job').on(t.jobId)],
)

/**
 * Normalized words of each record (search-text.ts), the search index. Written in the batch that
 * writes the record, and rebuilt when the search-text function changes.
 */
export const memoryTerms = sqliteTable(
  'memory_terms',
  {
    term: text('term').notNull(),
    recordId: text('record_id')
      .notNull()
      .references(() => memoryRecords.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.term, t.recordId] }),
    index('memory_terms_by_record').on(t.recordId),
  ],
)

/**
 * The revision each change moves a record, checkpoint, or skill to. A change updates its target
 * only at the revision it read and claims the next one in the same batch, so a second writer from
 * the same revision fails on this primary key and its whole batch rolls back.
 */
export const revisionClaims = sqliteTable(
  'revision_claims',
  {
    target: text('target', { enum: ['record', 'checkpoint', 'skill'] }).notNull(),
    targetId: text('target_id').notNull(),
    revision: integer('revision').notNull(),
    opId: text('op_id').notNull(),
    claimedAt: integer('claimed_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.target, t.targetId, t.revision] }),
    index('revision_claims_by_time').on(t.claimedAt),
  ],
)

/**
 * Set to a new random value with any change to a scope's active instructions, facts, or skills;
 * readers compare it for equality only, so concurrent changes never need to read it first.
 */
export const scopeRevisions = sqliteTable('scope_revisions', {
  scope: text('scope').$type<Scope>().primaryKey(),
  revision: integer('revision').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

/** Pi never reuses entry IDs, so one checkpoint per agent covers its whole life. */
export const extractionCheckpoints = sqliteTable('extraction_checkpoints', {
  agentId: text('agent_id').primaryKey(),
  lastEntryId: integer('last_entry_id').notNull(),
  revision: integer('revision').notNull().default(1),
  updatedAt: integer('updated_at').notNull(),
})

export const memoryLedger = sqliteTable(
  'memory_ledger',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    at: integer('at').notNull(),
    runId: text('run_id').notNull(),
    opId: text('op_id'),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    target: text('target', { enum: ['record', 'skill'] }).notNull(),
    targetId: text('target_id').notNull(),
    /** For a skill change: the body before it, so an earlier version can be restored by hand. */
    detailJson: text('detail_json'),
  },
  (t) => [index('memory_ledger_by_target').on(t.target, t.targetId, t.seq)],
)

// The catalog of archived ranges.

/**
 * Catalog of archived ranges. The entries, search index, and summary are R2 objects under
 * `r2Prefix`; pruning code writes the row after verifying them, and it lives as long as they do.
 */
export const archiveSegments = sqliteTable(
  'archive_segments',
  {
    /** `<agentId>/<first>-<last>` */
    id: text('id').primaryKey(),
    agentId: text('agent_id').notNull(),
    firstEntry: integer('first_entry').notNull(),
    lastEntry: integer('last_entry').notNull(),
    entryCount: integer('entry_count').notNull(),
    /** `archive/<agentId>/<first>-<last>` with `.jsonl`, `.manifest.json`, `.index.json`, `.summary.json`. */
    r2Prefix: text('r2_prefix').notNull(),
    sha256: text('sha256').notNull(),
    bytes: integer('bytes').notNull(),
    firstAt: integer('first_at').notNull(),
    lastAt: integer('last_at').notNull(),
    hasSummary: integer('has_summary', { mode: 'boolean' }).notNull().default(false),
    /** Extraction has covered this range; after pruning it reads the range from R2. */
    extracted: integer('extracted', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    unique('archive_segments_start').on(t.agentId, t.firstEntry),
    index('archive_segments_by_time').on(t.agentId, t.lastAt),
    check('archive_segments_range', lte(t.firstEntry, t.lastEntry)),
  ],
)

// Skills.

export const SKILL_STATUSES = ['active', 'archived'] as const

/**
 * One skill of one agent: a procedure written by the memory agent, its body stored in the row so
 * that a write is one statement. Working agents list active skills and read them by name.
 */
export const skills = sqliteTable(
  'skills',
  {
    agentId: text('agent_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    body: text('body').notNull(),
    status: text('status', { enum: SKILL_STATUSES }).notNull().default('active'),
    /** The entry ranges where the procedure worked, and lessons from failures. */
    evidence: text('evidence').notNull(),
    /** Incremented on every content or status change; writes compare it with what they read. */
    revision: integer('revision').notNull().default(1),
    /** Updated by working agents; never changes `revision`. */
    useCount: integer('use_count').notNull().default(0),
    lastUsedAt: integer('last_used_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.name] }),
    index('skills_by_status').on(t.agentId, t.status),
  ],
)
