/**
 * Pi Durable 1.2.0's own SQLite tables, for pruning only (docs/memory.md,
 * Pruning). Pi creates and migrates them; drizzle-kit never sees this file. Re-check these columns
 * and the pruning tests whenever Pi Durable is upgraded.
 */
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const piEntries = sqliteTable('entries', {
  id: integer('id').primaryKey(),
  conversationId: integer('conversation_id').notNull(),
  head: integer('head'),
  record: text('record').notNull(),
})

export const piConversations = sqliteTable('conversations', {
  id: integer('id').primaryKey(),
})

export const piTasks = sqliteTable('tasks', {
  id: integer('id').primaryKey(),
  status: text('status').notNull(),
})

export const piDocuments = sqliteTable('documents', {
  id: integer('id').primaryKey(),
  scopeKind: text('scope_kind').notNull(),
  ownerId: integer('owner_id').notNull(),
})

export const piDocumentRevisions = sqliteTable('document_revisions', {
  documentId: integer('document_id').notNull(),
})

export const piRecordIds = sqliteTable('record_ids', {
  id: integer('id').primaryKey(),
  recordType: text('record_type').notNull(),
})
