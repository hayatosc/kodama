/** D1 schema: the catalog of archived ranges (see records.ts for the conventions). */
import { lte } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

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
