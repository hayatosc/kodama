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
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Who can act: a person signed in through Access, a service token, or an agent. A principal is
 * registered on its first management RPC call.
 */
export const PRINCIPAL_KINDS = ['user', 'service', 'agent'] as const
/** The installation-wide role; roles on one agent are in `agent_members`. */
export const SYSTEM_ROLES = ['owner'] as const

/** People and services that call management RPC. */
export const principals = sqliteTable('principals', {
  principalId: text('principal_id').primaryKey(),
  kind: text('kind', { enum: PRINCIPAL_KINDS }).notNull(),
  /** The Access email, service token ID, or agent ID, as the calling Worker authenticated it. */
  externalId: text('external_id').notNull().unique(),
  displayName: text('display_name').notNull(),
  systemRole: text('system_role', { enum: SYSTEM_ROLES }),
  createdAt: integer('created_at').notNull(),
  disabledAt: integer('disabled_at'),
})

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
    /** NULL for dedicated agents, which the installation owns. */
    ownerId: text('owner_id').references(() => principals.principalId),
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
    /** NULL when the system wrote it (the seed). */
    authorId: text('author_id').references(() => principals.principalId),
    comment: text('comment'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.version] })],
)

/** Encrypted provider secrets; only src/credentials/ may access these rows. */
export const credentials = sqliteTable('credentials', {
  credentialId: text('credential_id').primaryKey(),
  kind: text('kind', { enum: ['api_key', 'oauth_subscription'] }).notNull(),
  provider: text('provider').notNull(),
  /** NULL means installation ownership; otherwise the owning principal. */
  ownerId: text('owner_id').references(() => principals.principalId),
  status: text('status', { enum: ['active', 'retiring', 'revoked', 'needs_reauth'] }).notNull(),
  revision: integer('revision').notNull(),
  kekVersion: integer('kek_version').notNull(),
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
    credentialId: text('credential_id')
      .notNull()
      .references(() => credentials.credentialId),
    provider: text('provider').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.provider] }),
    index('agent_credential_refs_by_credential').on(t.credentialId),
  ],
)

/** Roles on one agent. */
export const MEMBER_ROLES = ['owner', 'operator', 'user', 'viewer'] as const

/** Who may do what with one agent. */
export const agentMembers = sqliteTable(
  'agent_members',
  {
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.agentId),
    principalId: text('principal_id')
      .notNull()
      .references(() => principals.principalId),
    role: text('role', { enum: MEMBER_ROLES }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.principalId] }),
    index('agent_members_by_principal').on(t.principalId),
  ],
)

/** Keys of `system_settings`. */
export const SYSTEM_SETTING_KEYS = ['install_id', 'reconcile_cursor'] as const

/**
 * Installation settings. The seed writes the installation ID once, and it never changes;
 * reconciliation keeps the agent ID its last run stopped at.
 */
export const systemSettings = sqliteTable('system_settings', {
  key: text('key', { enum: SYSTEM_SETTING_KEYS }).primaryKey(),
  valueJson: text('value_json').notNull(),
})

/** What an audit row is about. */
export const AUDIT_TARGETS = ['agent', 'principal', 'system'] as const

/** Append-only audit, written in the same batch as the change it records. */
export const auditLog = sqliteTable(
  'audit_log',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    /** The retry key: a resent change fails here, and the retry is answered from the first. */
    opId: text('op_id').notNull().unique(),
    at: integer('at').notNull(),
    /** NULL for the system (seed, reconciliation). */
    actorId: text('actor_id').references(() => principals.principalId),
    action: text('action').notNull(),
    targetKind: text('target_kind', { enum: AUDIT_TARGETS }).notNull(),
    targetId: text('target_id').notNull(),
    /** IDs, versions, and names only; never secrets. */
    detailJson: text('detail_json').notNull().default('{}'),
  },
  (t) => [index('audit_log_by_target').on(t.targetId, t.seq)],
)
