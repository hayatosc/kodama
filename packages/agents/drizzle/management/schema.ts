/**
 * The D1 schema of the management database: one file for the one database. `nr db:generate:management`
 * turns this file into the migrations in ./migrations.
 *
 * Times are Unix epoch milliseconds; IDs are lowercase UUID text. Ledger rows are never deleted, so
 * an agent ID is never reused, and foreign keys keep SQLite's default `NO ACTION`. Writes use plain
 * inserts, so a constraint violation fails its statement and rolls back the whole `batch()`; only
 * the idempotent seed and the registration of a principal use `ON CONFLICT DO NOTHING`, and
 * reconciliation upserts its cursor.
 *
 * @see docs/agents.md — Management database
 *
 * @module
 */
import { eq } from 'drizzle-orm'
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

/** Management actions originate from the authenticated operator or internal automation, not users. */
export const MANAGEMENT_SOURCES = ['operator', 'system'] as const

/** Short-lived host-recognized instructions; the source identity is not model supplied. */
export const mcpIntents = sqliteTable('mcp_intents', {
  intentId: text('intent_id').primaryKey(),
  principalId: text('principal_id').notNull(),
  sourceAgentId: text('source_agent_id').notNull(),
  conversationId: text('conversation_id').notNull(),
  entryId: integer('entry_id').notNull(),
  submissionId: text('submission_id').notNull(),
  instructionJson: text('instruction_json').notNull(),
  expiresAt: integer('expires_at').notNull(),
  consumedAt: integer('consumed_at'),
})

/** Registration progress survives OAuth without preserving assignment authority. */
export const mcpRequests = sqliteTable('mcp_requests', {
  requestId: text('request_id').primaryKey(),
  principalId: text('principal_id').notNull(),
  sourceAgentId: text('source_agent_id').notNull(),
  conversationId: text('conversation_id').notNull(),
  entryId: integer('entry_id').notNull(),
  submissionId: text('submission_id').notNull(),
  serverId: text('server_id'),
  serverRevision: integer('server_revision'),
  credentialId: text('credential_id'),
  status: text('status', {
    enum: [
      'awaiting_endpoint',
      'registered_unverified',
      'awaiting_owner_auth',
      'ready_for_discovery',
      'discovered',
      'failed',
    ],
  }).notNull(),
  name: text('name').notNull(),
  notifiedAt: integer('notified_at'),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
})

/** Host-generated review proposal: confirmation must name this target and a subset of its tool IDs. */
export const mcpProposals = sqliteTable('mcp_proposals', {
  proposalId: text('proposal_id').primaryKey(),
  requestId: text('request_id').notNull(),
  principalId: text('principal_id').notNull(),
  sourceAgentId: text('source_agent_id').notNull(),
  conversationId: text('conversation_id').notNull(),
  serverId: text('server_id').notNull(),
  serverRevision: integer('server_revision').notNull(),
  catalogDigest: text('catalog_digest').notNull(),
  credentialId: text('credential_id').notNull(),
  agentId: text('agent_id').notNull(),
  toolIdsJson: text('tool_ids_json').notNull(),
  expiresAt: integer('expires_at').notNull(),
})

/** Atomic MCP authorization fences: a false predicate aborts the entire D1 batch. */
export const mcpCommits = sqliteTable(
  'mcp_commits',
  {
    operationId: text('operation_id').primaryKey(),
    authorized: integer('authorized', { mode: 'boolean' }).notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [check('mcp_commit_authorized', eq(table.authorized, true).inlineParams())],
)

/** A working agent, or a dedicated agent under a reserved object name. */
export const AGENT_KINDS = ['working', 'dedicated'] as const
/** Lifecycle states; docs/agents.md (Lifecycle) lists the planned moves. */
export const AGENT_STATUSES = [
  'provisioning',
  'active',
  'pausing',
  'paused',
  'archived',
  'deleting',
  'deleted',
] as const
/** The last step a purge finished; a stopped purge resumes after it. */
export const PURGE_STATES = ['management', 'memory', 'archive', 'object', 'done'] as const

/**
 * The agent registry: one row per agent, never deleted. `agent_id` is the outward identity;
 * `object_name` is the Durable Object name and the storage key, equal to `agent_id` except for
 * dedicated agents.
 */
export const agents = sqliteTable(
  'agents',
  {
    agentId: text('agent_id').primaryKey(),
    objectName: text('object_name').notNull().unique(),
    kind: text('kind', { enum: AGENT_KINDS }).notNull(),
    displayName: text('display_name').notNull(),
    /** An alias, unique when set; never UUID-shaped (checked in src/validation.ts). */
    slug: text('slug').unique(),
    status: text('status', { enum: AGENT_STATUSES }).notNull(),
    purgeState: text('purge_state', { enum: PURGE_STATES }),
    /** The desired version: the newest one written. */
    currentVersion: integer('current_version').notNull(),
    /** The newest version the object reported as fully applied; 0 before the first. */
    appliedVersion: integer('applied_version').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('agents_by_status').on(t.status, t.createdAt)],
)

/**
 * Immutable configuration versions, numbered per agent from 1. Inserting `expected + 1` is the
 * optimistic lock: a second writer from the same version fails on the primary key, and its batch
 * rolls back.
 */
export const agentConfigVersions = sqliteTable(
  'agent_config_versions',
  {
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.agentId),
    version: integer('version').notNull(),
    /** The version's `AgentSettings` as JSON. */
    settingsJson: text('settings_json').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    source: text('source', { enum: MANAGEMENT_SOURCES }).notNull(),
    comment: text('comment'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.version] })],
)

/** Shared MCP registrations. Only the creator may change the endpoint or vetted catalog. */
export const mcpServers = sqliteTable('mcp_servers', {
  serverId: text('server_id').primaryKey(),
  shortId: text('short_id').notNull().unique(),
  creatorId: text('creator_id')
    .notNull()
    .references(() => principals.principalId),
  name: text('name').notNull(),
  endpoint: text('endpoint').notNull().unique(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  revision: integer('revision').notNull().default(1),
  catalogDigest: text('catalog_digest'),
  catalogVersion: integer('catalog_version').notNull().default(0),
  inspectedAt: integer('inspected_at'),
  inspectionError: text('inspection_error'),
  stale: integer('stale', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

/** Stable tool IDs survive renames of the registration; changed definitions require new approval. */
export const mcpTools = sqliteTable(
  'mcp_tools',
  {
    toolId: text('tool_id').primaryKey(),
    serverId: text('server_id')
      .notNull()
      .references(() => mcpServers.serverId),
    remoteName: text('remote_name').notNull(),
    modelName: text('model_name').notNull().unique(),
    serverRevision: integer('server_revision').notNull(),
    digest: text('digest').notNull(),
    definitionJson: text('definition_json').notNull(),
    rejection: text('rejection'),
    present: integer('present', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [unique('mcp_tool_remote_name').on(t.serverId, t.remoteName)],
)

/** Immutable definitions retained for pinned applied versions, never overwritten by discovery. */
export const mcpDefinitions = sqliteTable('mcp_definitions', {
  digest: text('digest').primaryKey(),
  definitionJson: text('definition_json').notNull(),
})

/** Live selected-tool index; removing a row rejects sends before a delayed safe apply. */
export const mcpAssignments = sqliteTable(
  'mcp_assignments',
  {
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.agentId),
    serverId: text('server_id')
      .notNull()
      .references(() => mcpServers.serverId),
    toolId: text('tool_id')
      .notNull()
      .references(() => mcpTools.toolId),
    credentialId: text('credential_id')
      .notNull()
      .references(() => credentials.credentialId),
    digest: text('digest').notNull(),
    serverRevision: integer('server_revision').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.toolId] }),
    index('mcp_assignments_credential').on(t.credentialId),
  ],
)

/** One-time browser-bound OAuth exchanges; the verifier is an envelope in the existing vault. */
export const mcpOAuthTransactions = sqliteTable('mcp_oauth_transactions', {
  requestId: text('request_id'),
  transactionId: text('transaction_id').primaryKey(),
  principalId: text('principal_id')
    .notNull()
    .references(() => principals.principalId),
  serverId: text('server_id')
    .notNull()
    .references(() => mcpServers.serverId),
  serverRevision: integer('server_revision').notNull(),
  stateDigest: text('state_digest').notNull().unique(),
  browserDigest: text('browser_digest').notNull(),
  bindingJson: text('binding_json').notNull(),
  verifierId: text('verifier_id').notNull(),
  status: text('status', {
    enum: ['pending', 'exchanging', 'completed', 'denied', 'reauth_required'],
  }).notNull(),
  credentialId: text('credential_id'),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
})

/** Issuer-bound client registration, including failed DCR claims to prevent automatic replay. */
export const mcpOAuthClients = sqliteTable(
  'mcp_oauth_clients',
  {
    registrationId: text('registration_id').primaryKey(),
    principalId: text('principal_id')
      .notNull()
      .references(() => principals.principalId),
    serverId: text('server_id')
      .notNull()
      .references(() => mcpServers.serverId),
    issuer: text('issuer').notNull(),
    redirectUri: text('redirect_uri').notNull(),
    metadataJson: text('metadata_json'),
    secretId: text('secret_id'),
    status: text('status', { enum: ['registering', 'ready', 'reauth_required'] }).notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    unique('mcp_oauth_client_binding').on(t.principalId, t.serverId, t.issuer, t.redirectUri),
  ],
)

/** Encrypted provider and MCP secrets; only src/credentials/ may access these rows. */
export const credentials = sqliteTable(
  'credentials',
  {
    credentialId: text('credential_id').primaryKey(),
    kind: text('kind', {
      enum: [
        'api_key',
        'oauth_subscription',
        'mcp_bearer',
        'mcp_oauth',
        'mcp_client',
        'mcp_transaction',
      ],
    }).notNull(),
    purpose: text('purpose', { enum: ['model_provider', 'mcp_server'] })
      .notNull()
      .default('model_provider'),
    provider: text('provider').notNull(),
    status: text('status', { enum: ['active', 'revoked', 'needs_reauth'] }).notNull(),
    mcpAuthState: text('mcp_auth_state', {
      enum: ['reauth_required', 'scope_required', 'outcome_unknown'],
    }),
    revision: integer('revision').notNull(),
    ciphertext: text('ciphertext'),
    iv: text('iv'),
    wrappedDek: text('wrapped_dek'),
    wrapIv: text('wrap_iv'),
    fingerprint: text('fingerprint').notNull(),
    last4: text('last4').notNull(),
    leaseId: text('lease_id'),
    leaseExpiresAt: integer('lease_expires_at'),
    createdAt: integer('created_at').notNull(),
    revokedAt: integer('revoked_at'),
    lastUsedAt: integer('last_used_at'),
    expiresAt: integer('expires_at'),
    lastRefreshedAt: integer('last_refreshed_at'),
    refreshFailures: integer('refresh_failures').notNull().default(0),
    lastRefreshFailureAt: integer('last_refresh_failure_at'),
    lastRefreshFailureCategory: text('last_refresh_failure_category', {
      enum: ['rejected', 'transient', 'malformed', 'failed'],
    }),
  },
  (t) => [unique('credentials_id_provider').on(t.credentialId, t.provider)],
)

/** Daily additive buckets. Explicit identity includes null credentials and completeness. */
export const usageDaily = sqliteTable(
  'usage_daily',
  {
    bucket: text('bucket').primaryKey(),
    day: text('day').notNull(),
    chargedAgentId: text('charged_agent_id').notNull(),
    credentialId: text('credential_id'),
    credentialKind: text('credential_kind', { enum: ['api_key', 'oauth_subscription'] }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    actorKind: text('actor_kind', { enum: ['user', 'agent', 'system'] }).notNull(),
    usageState: text('usage_state', {
      enum: ['reported', 'partial', 'unknown', 'not_applicable'],
    }).notNull(),
    attempts: integer('attempts').notNull(),
    failed: integer('failed').notNull(),
    rateLimited: integer('rate_limited').notNull(),
    input: integer('input').notNull(),
    output: integer('output').notNull(),
    cacheRead: integer('cache_read').notNull(),
    cacheWrite: integer('cache_write').notNull(),
    totalTokens: integer('total_tokens').notNull(),
    reasoning: integer('reasoning').notNull(),
    cacheWrite1h: integer('cache_write_1h').notNull(),
    reasoningReported: integer('reasoning_reported').notNull(),
    cacheWrite1hReported: integer('cache_write_1h_reported').notNull(),
    costUsd: real('cost_usd').notNull(),
  },
  (t) => [index('usage_daily_by_day_agent').on(t.day, t.chargedAgentId)],
)

/** Monotonic acknowledgment checkpoint per executing object; retained indefinitely. */
export const usageIngestion = sqliteTable('usage_ingestion', {
  agentId: text('agent_id').primaryKey(),
  lastSeq: integer('last_seq').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
  caughtUp: integer('caught_up', { mode: 'boolean' }).notNull().default(false),
})

/** Permission to use a credential, independent of immutable configuration references. */
export const credentialGrants = sqliteTable(
  'credential_grants',
  {
    credentialId: text('credential_id')
      .notNull()
      .references(() => credentials.credentialId),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.agentId),
  },
  (t) => [primaryKey({ columns: [t.credentialId, t.agentId] })],
)

/** Reverse index of current credential references. */
export const agentCredentialRefs = sqliteTable(
  'agent_credential_refs',
  {
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.agentId),
    credentialId: text('credential_id').notNull(),
    provider: text('provider').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.provider] }),
    index('agent_credential_refs_by_credential').on(t.credentialId),
    foreignKey({
      columns: [t.credentialId, t.provider],
      foreignColumns: [credentials.credentialId, credentials.provider],
    }),
  ],
)

/** Keys of `system_settings`. */
export const SYSTEM_SETTING_KEYS = ['install_id', 'reconcile_cursor', 'usage_sweep_cursor'] as const

/**
 * Installation settings. The seed writes the installation ID once, and it never changes;
 * reconciliation keeps the agent ID its last run stopped at.
 */
export const systemSettings = sqliteTable('system_settings', {
  key: text('key', { enum: SYSTEM_SETTING_KEYS }).primaryKey(),
  valueJson: text('value_json').notNull(),
})

/** What an audit row is about. */
export const AUDIT_TARGETS = ['agent', 'system'] as const

/** Append-only audit, written in the same batch as the change it records. */
export const auditLog = sqliteTable(
  'audit_log',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    /** The retry key: a resent change fails here, and the retry is answered from the first. */
    opId: text('op_id').notNull().unique(),
    at: integer('at').notNull(),
    source: text('source', { enum: MANAGEMENT_SOURCES }).notNull(),
    action: text('action').notNull(),
    targetKind: text('target_kind', { enum: AUDIT_TARGETS }).notNull(),
    targetId: text('target_id').notNull(),
    /** IDs, versions, and names only; never secrets. */
    detailJson: text('detail_json').notNull().default('{}'),
  },
  (t) => [index('audit_log_by_target').on(t.targetId, t.seq)],
)
