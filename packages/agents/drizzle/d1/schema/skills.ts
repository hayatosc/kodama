/** D1 schema: skills, their pending writes, and their uses (see records.ts for the conventions). */
import { foreignKey, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { Scope } from './records.ts'

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
  (t) => [index('skill_writes_pending').on(t.status, t.createdAt)],
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
