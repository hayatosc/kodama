/**
 * Tables kodama keeps in each agent's own Durable Object SQLite, next to Pi Durable's tables.
 * `nr db:generate:durable-object` writes the migrations in ./migrations, which src/storage/local.ts applies
 * when the object starts. Times are Unix epoch milliseconds.
 *
 * @module
 */
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
