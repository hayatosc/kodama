/** D1 schema: proposals to shared spaces (see records.ts for the conventions). */
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
  (t) => [index('shared_proposals_by_status').on(t.status, t.space, t.proposedAt)],
)
