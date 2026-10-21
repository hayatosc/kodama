/**
 * D1 schema for long-term memory (docs/design/long-term-memory.md). `drizzle-kit generate` turns it
 * into the migrations in ../../migrations; the FTS5 table and its triggers are a custom migration.
 * Times are Unix epoch milliseconds. Writes use plain inserts, never `INSERT OR IGNORE`: a
 * constraint violation must fail the statement so that the whole `batch()` rolls back.
 */
import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core'

export type Scope = `agent:${string}` | `shared:${string}`
export const RECORD_KINDS = ['fact', 'event', 'instruction', 'task'] as const
export const RECORD_STATUSES = ['active', 'superseded', 'invalid', 'archived'] as const
export const RECORD_ORIGINS = [
  'user_request',
  'agent_judgment',
  'extraction',
  'consolidation',
  'proposal',
] as const

export const memoryRecords = sqliteTable(
  'memory_records',
  {
    id: text('id').primaryKey(),
    scope: text('scope').$type<Scope>().notNull(),
    kind: text('kind', { enum: RECORD_KINDS }).notNull(),
    content: text('content').notNull(),
    /** Normalized words of `content`; see search-text.ts. */
    searchText: text('search_text').notNull(),
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
    index('memory_records_by_override')
      .on(t.overrides)
      .where(sql`${t.overrides} IS NOT NULL`),
    check('memory_records_scope', sql`${t.scope} GLOB 'agent:*' OR ${t.scope} GLOB 'shared:*'`),
    check('memory_records_kind', sql`${t.kind} IN ('fact', 'event', 'instruction', 'task')`),
    check('memory_records_content', sql`length(${t.content}) BETWEEN 1 AND 2000`),
    check(
      'memory_records_status',
      sql`${t.status} IN ('active', 'superseded', 'invalid', 'archived')`,
    ),
    check(
      'memory_records_origin',
      sql`${t.origin} IN ('user_request', 'agent_judgment', 'extraction', 'consolidation', 'proposal')`,
    ),
    check('memory_records_importance', sql`${t.importance} BETWEEN 0 AND 1`),
    check(
      'memory_records_superseded',
      sql`(${t.status} = 'superseded') = (${t.supersededBy} IS NOT NULL)`,
    ),
    check('memory_records_overrides', sql`${t.overrides} IS NULL OR ${t.scope} GLOB 'agent:*'`),
    check(
      'memory_records_required',
      sql`${t.required} = 0 OR (${t.scope} GLOB 'shared:*' AND ${t.kind} IN ('fact', 'instruction'))`,
    ),
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
    /**
     * `changes()` of the guarded update right before this insert, or 1 when there is none. A
     * guarded update that matched no row fails the check, so the whole batch rolls back.
     */
    guard: integer('guard').notNull(),
    appliedAt: integer('applied_at').notNull(),
  },
  (t) => [index('memory_ops_by_job').on(t.jobId), check('memory_ops_guard', sql`${t.guard} = 1`)],
)

/** Advanced with any change to a scope's active instructions, facts, or skills. */
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
    check('archive_segments_range', sql`${t.firstEntry} <= ${t.lastEntry}`),
  ],
)

export const SKILL_STATUSES = ['proposed', 'active', 'stale', 'archived'] as const

export const skills = sqliteTable(
  'skills',
  {
    scope: text('scope').$type<Scope>().notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    status: text('status', { enum: SKILL_STATUSES }).notNull(),
    /** R2 directory, overwritten in place on update: `skills/<scope>/<name>/`. */
    r2Key: text('r2_key').notNull(),
    /** SHA-256 over the sorted list of each path and its file's SHA-256. */
    contentSha256: text('content_sha256').notNull(),
    revision: integer('revision').notNull().default(1),
    evidenceJson: text('evidence_json').notNull(),
    /** For an agent skill that overrides a shared one: `<scope>/<name>@<content_sha256>`. */
    basedOn: text('based_on'),
    /** For an agent skill merged into a shared one: `<scope>/<name>`. */
    absorbedInto: text('absorbed_into'),
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.scope, t.name] }),
    index('skills_by_status').on(t.scope, t.status),
    index('skills_by_name').on(t.name, t.status),
    check('skills_scope', sql`${t.scope} GLOB 'agent:*' OR ${t.scope} GLOB 'shared:*'`),
    check(
      'skills_name',
      sql`${t.name} NOT GLOB '*[^a-z0-9-]*' AND length(${t.name}) BETWEEN 1 AND 64`,
    ),
    check('skills_description', sql`length(${t.description}) BETWEEN 1 AND 1024`),
    check('skills_status', sql`${t.status} IN ('proposed', 'active', 'stale', 'archived')`),
    check(
      'skills_absorbed',
      sql`${t.absorbedInto} IS NULL OR (${t.scope} GLOB 'agent:*' AND ${t.status} = 'archived')`,
    ),
  ],
)

/**
 * A skill update recorded before any file is overwritten. Before and after files are blobs in R2
 * at `skills/.blobs/<sha256>`, so a pending write is finished by copying the after files again.
 */
export const skillWrites = sqliteTable(
  'skill_writes',
  {
    opId: text('op_id').primaryKey(),
    scope: text('scope').$type<Scope>().notNull(),
    name: text('name').notNull(),
    baseRevision: integer('base_revision'),
    /** `[{ path, before_sha256, after_sha256 }]`; a null before adds a file, a null after removes it. */
    filesJson: text('files_json').notNull(),
    /** The skills row to write and the operation's job: what finishing the write needs. */
    skillJson: text('skill_json').notNull(),
    status: text('status', { enum: ['pending', 'done'] })
      .notNull()
      .default('pending'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('skill_writes_pending').on(t.status, t.createdAt),
    check('skill_writes_status', sql`${t.status} IN ('pending', 'done')`),
  ],
)

/** Uses per agent, so shared skills can be curated by who still uses them. */
export const skillUsage = sqliteTable(
  'skill_usage',
  {
    scope: text('scope').$type<Scope>().notNull(),
    name: text('name').notNull(),
    agentId: text('agent_id').notNull(),
    useCount: integer('use_count').notNull().default(0),
    lastUsedAt: integer('last_used_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.scope, t.name, t.agentId] }),
    foreignKey({
      columns: [t.scope, t.name],
      foreignColumns: [skills.scope, skills.name],
    }).onDelete('cascade'),
    index('skill_usage_by_agent').on(t.agentId, t.lastUsedAt),
  ],
)

export const PROPOSAL_STATUSES = ['accepted', 'applied', 'rejected', 'conflict'] as const

/**
 * A change to a shared scope. Code checks it when it is written, with no person in the loop:
 * `accepted` passed the checks and is not yet applied, so the memory agent applies every accepted
 * row; `rejected` failed them, with the reason.
 */
export const sharedProposals = sqliteTable(
  'shared_proposals',
  {
    id: text('id').primaryKey(),
    space: text('space').notNull(),
    target: text('target', { enum: ['record', 'skill'] }).notNull(),
    /** For a record: the ID it replaces, or `<scope>` for a new one; for a skill: `<scope>/<name>`. */
    targetKey: text('target_key').notNull(),
    /** Revision of the target the proposal was written against; null when the target is new. */
    baseRevision: integer('base_revision'),
    /** Concrete operations applied by code: record contents, or skill files already in R2. */
    payloadJson: text('payload_json').notNull(),
    sourceIdsJson: text('source_ids_json').notNull(),
    status: text('status', { enum: PROPOSAL_STATUSES }).notNull(),
    runId: text('run_id').notNull(),
    proposedAt: integer('proposed_at').notNull(),
    /** The rule set that decided, such as `checks:1`. */
    decidedBy: text('decided_by').notNull(),
    reason: text('reason'),
    appliedAt: integer('applied_at'),
  },
  (t) => [
    index('shared_proposals_by_status').on(t.status, t.space, t.proposedAt),
    check('shared_proposals_target', sql`${t.target} IN ('record', 'skill')`),
    check(
      'shared_proposals_status',
      sql`${t.status} IN ('accepted', 'applied', 'rejected', 'conflict')`,
    ),
    check(
      'shared_proposals_applied',
      sql`(${t.status} = 'applied') = (${t.appliedAt} IS NOT NULL)`,
    ),
  ],
)

export const memoryLedger = sqliteTable(
  'memory_ledger',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    at: integer('at').notNull(),
    runId: text('run_id').notNull(),
    opId: text('op_id'),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    target: text('target', { enum: ['record', 'skill', 'proposal'] }).notNull(),
    targetId: text('target_id').notNull(),
    /** For a skill change: `[{ path, before_sha256, after_sha256 }]`, whose blobs stay in R2. */
    detailJson: text('detail_json'),
  },
  (t) => [
    index('memory_ledger_by_target').on(t.target, t.targetId, t.seq),
    check('memory_ledger_target', sql`${t.target} IN ('record', 'skill', 'proposal')`),
  ],
)
