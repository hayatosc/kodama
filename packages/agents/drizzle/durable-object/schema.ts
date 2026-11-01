/**
 * Tables kodama keeps in each agent's own Durable Object SQLite, next to Pi Durable's tables.
 * `nr db:generate:durable-object` writes the migrations in ./migrations, which src/storage/local.ts applies
 * when the object starts. Times are Unix epoch milliseconds.
 *
 * @module
 */
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import type { ScheduleSpec } from '../../src/agent/schedule-spec.ts'
import type { CompletionOutcome, ContactResult } from '../../src/extensions.ts'

/** Object-owned metadata; bytes live under an agent-scoped R2 prefix, never in SQLite. */
export const artifacts = sqliteTable(
  'kodama_artifacts',
  {
    id: text('id').primaryKey(),
    filename: text('filename').notNull(),
    mediaType: text('media_type').notNull(),
    size: integer('size').notNull(),
    storageKey: text('storage_key').notNull().unique(),
    state: text('state', { enum: ['uploading', 'ready', 'deleting'] }).notNull(),
    sourceTask: text('source_task'),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('kodama_artifacts_expiry').on(t.expiresAt)],
)

/** Sender-side outbox: immutable delivery identity is recorded before contacting another DO. */
export const contactRequests = sqliteTable(
  'kodama_contact_requests',
  {
    id: text('id').primaryKey(),
    sourceTask: text('source_task').notNull().unique(),
    sourceEntry: integer('source_entry').notNull(),
    arguments: text('arguments').notNull(),
    targetAgentId: text('target_agent_id').notNull(),
    requestId: text('request_id').notNull().unique(),
    content: text('content').notNull(),
    hop: integer('hop').notNull(),
    state: text('state', { enum: ['dispatching', 'submitted', 'settled', 'failed'] }).notNull(),
    submissionId: integer('submission_id'),
    retryAt: integer('retry_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    result: text('result', { mode: 'json' }).$type<ContactResult>(),
    createdAt: integer('created_at').notNull(),
    settledAt: integer('settled_at'),
    expiresAt: integer('expires_at'),
  },
  (t) => [
    index('kodama_contact_requests_pending').on(t.state, t.retryAt),
    index('kodama_contact_requests_expiry').on(t.expiresAt),
  ],
)

/** Receiver-side result receipt; retain before Pi history is pruned and until delivery is safe. */
export const contactReceipts = sqliteTable(
  'kodama_contact_receipts',
  {
    senderAgentId: text('sender_agent_id').notNull(),
    requestId: text('request_id').notNull(),
    submissionId: integer('submission_id').notNull(),
    result: text('result', { mode: 'json' }).$type<ContactResult>(),
    createdAt: integer('created_at').notNull(),
    settledAt: integer('settled_at'),
    acknowledgedAt: integer('acknowledged_at'),
    expiresAt: integer('expires_at'),
  },
  (t) => [
    primaryKey({ columns: [t.senderAgentId, t.requestId] }),
    index('kodama_contact_receipts_submission').on(t.submissionId),
    index('kodama_contact_receipts_expiry').on(t.expiresAt),
  ],
)

/** Agent-wide inbox; a source has exactly one retained terminal notification. */
export const notifications = sqliteTable(
  'kodama_notifications',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    source: text('source', { enum: ['contact', 'schedule'] }).notNull(),
    sourceId: text('source_id').notNull(),
    outcome: text('outcome').$type<CompletionOutcome>().notNull(),
    summary: text('summary').notNull(),
    artifactIds: text('artifact_ids', { mode: 'json' }).$type<string[]>().notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    readAt: integer('read_at'),
  },
  (t) => [
    uniqueIndex('kodama_notifications_source').on(t.source, t.sourceId),
    index('kodama_notifications_unread').on(t.readAt, t.seq),
    index('kodama_notifications_expiry').on(t.expiresAt),
  ],
)

/** Immutable reservation and replay identity; the cursor survives occurrence retention. */
export const scheduledTasks = sqliteTable(
  'kodama_scheduled_tasks',
  {
    id: text('id').primaryKey(),
    sourceTask: text('source_task').notNull().unique(),
    sourceEntry: integer('source_entry').notNull(),
    arguments: text('arguments').notNull(),
    instruction: text('instruction').notNull(),
    rule: text('rule', { mode: 'json' }).$type<ScheduleSpec>().notNull(),
    state: text('state', { enum: ['active', 'completed', 'cancelled', 'failed'] }).notNull(),
    nextDue: integer('next_due'),
    cursor: integer('cursor'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('kodama_scheduled_tasks_due').on(t.state, t.nextDue)],
)

/** One claimed nominal time; receipt is persisted before Pi history can be pruned. */
export const scheduledTaskOccurrences = sqliteTable(
  'kodama_scheduled_occurrences',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => scheduledTasks.id),
    nominalAt: integer('nominal_at').notNull(),
    coalescedFrom: integer('coalesced_from').notNull(),
    state: text('state', { enum: ['dispatching', 'submitted', 'settled', 'failed'] }).notNull(),
    submissionId: integer('submission_id'),
    admissionStarted: integer('admission_started', { mode: 'boolean' }).notNull().default(false),
    retryAt: integer('retry_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    outcome: text('outcome'),
    settledAt: integer('settled_at'),
  },
  (t) => [
    uniqueIndex('kodama_scheduled_occurrences_nominal').on(t.taskId, t.nominalAt),
    index('kodama_scheduled_occurrences_pending').on(t.state, t.retryAt),
  ],
)

/** One outer Pi model invocation; IDs are never reused after retention deletes. */
export const usage = sqliteTable('kodama_usage', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
  chargedAgentId: text('charged_agent_id').notNull(),
  actorKind: text('actor_kind', { enum: ['user', 'agent', 'system'] }).notNull(),
  jobId: text('job_id'),
  credentialId: text('credential_id'),
  credentialKind: text('credential_kind', { enum: ['api_key', 'oauth_subscription'] }),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  responseModel: text('response_model'),
  status: text('status', {
    enum: ['in_flight', 'succeeded', 'failed', 'aborted', 'interrupted'],
  })
    .notNull()
    .default('in_flight'),
  rateLimited: integer('rate_limited', { mode: 'boolean' }).notNull().default(false),
  usageState: text('usage_state', {
    enum: ['reported', 'partial', 'unknown', 'not_applicable'],
  })
    .notNull()
    .default('unknown'),
  input: integer('input'),
  output: integer('output'),
  cacheRead: integer('cache_read'),
  cacheWrite: integer('cache_write'),
  totalTokens: integer('total_tokens'),
  reasoning: integer('reasoning'),
  cacheWrite1h: integer('cache_write_1h'),
  inputCost: real('input_cost'),
  outputCost: real('output_cost'),
  cacheReadCost: real('cache_read_cost'),
  cacheWriteCost: real('cache_write_cost'),
  totalCost: real('total_cost'),
  aggregatedAt: integer('aggregated_at'),
})

/** Where a memory agent job is in the queue. */
export const JOB_STATUSES = ['queued', 'running', 'settled'] as const
/** How a settled memory agent job ended. */
export const JOB_OUTCOMES = ['persisted', 'declined', 'conflict', 'failed'] as const

/** The memory agent's job queue; at most one job is `running`. */
export const memoryJobs = sqliteTable(
  'kodama_memory_jobs',
  {
    jobId: text('job_id').primaryKey(),
    kind: text('kind').notNull(),
    /** Lower runs first. */
    priority: integer('priority').notNull(),
    payloadJson: text('payload_json').notNull(),
    status: text('status', { enum: JOB_STATUSES }).notNull().default('queued'),
    outcome: text('outcome', { enum: JOB_OUTCOMES }),
    attempts: integer('attempts').notNull().default(0),
    notBefore: integer('not_before').notNull(),
    /** When the current attempt started; its time limit counts from here, across evictions. */
    startedAt: integer('started_at'),
    createdAt: integer('created_at').notNull(),
    settledAt: integer('settled_at'),
  },
  (t) => [index('kodama_memory_jobs_next').on(t.status, t.priority, t.createdAt)],
)

/** `remember` calls per user entry, so one turn can save at most a few memories. */
export const rememberTurns = sqliteTable('kodama_remember_turns', {
  entryId: integer('entry_id').primaryKey(),
  count: integer('count').notNull(),
})

/** The rendered always-loaded memory and the scope revisions it was built from (one row). */
export const alwaysLoaded = sqliteTable('kodama_always_loaded', {
  id: integer('id').primaryKey(),
  text: text('text').notNull(),
  revisionsJson: text('revisions_json').notNull(),
  /** The skills this agent sees, as listed in its `skills` section. */
  skillsJson: text('skills_json').notNull().default('[]'),
  checkedAt: integer('checked_at').notNull(),
})

/** The steps of a pruning run, in order; a stopped run resumes from its state. */
export const PRUNE_STATES = ['prepared', 'exported', 'indexed', 'deleted'] as const

/** One pruning run per archived range; at most one is unfinished. */
export const pruneRuns = sqliteTable(
  'kodama_prune_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    firstEntry: integer('first_entry').notNull(),
    lastEntry: integer('last_entry').notNull(),
    /** `head` of the newest head marker when the run was prepared. */
    head: integer('head').notNull(),
    state: text('state', { enum: PRUNE_STATES }).notNull(),
    entryCount: integer('entry_count'),
    bytes: integer('bytes'),
    sha256: text('sha256'),
    firstAt: integer('first_at'),
    lastAt: integer('last_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('kodama_prune_runs_by_state').on(t.state)],
)

/** Legacy first-contact metadata; it no longer controls permissions or learning. */
export const externalData = sqliteTable('kodama_external_data', {
  root: text('root').primaryKey(),
  reason: text('reason').notNull(),
  contactedAt: integer('contacted_at').notNull(),
  eligibleThrough: integer('eligible_through').notNull(),
})

/**
 * URLs whose provenance lies outside the model: the owner wrote them in a message, a search
 * returned them, or a fetched page linked to them. Every `web_fetch` call requires a known URL;
 * these URLs are not consumed.
 */
export const knownUrls = sqliteTable(
  'kodama_known_urls',
  {
    root: text('root').notNull(),
    url: text('url').notNull(),
    source: text('source', { enum: ['owner', 'search', 'page'] }).notNull(),
    grantedAt: integer('granted_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.root, t.url] }),
    index('kodama_known_urls_by_age').on(t.root, t.grantedAt),
  ],
)
