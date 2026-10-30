/**
 * Pi Durable 1.2.0's own SQLite tables, declared only for pruning to read and delete from. Pi
 * creates and migrates them; drizzle-kit never sees this file.
 *
 * @see docs/memory.md — Pruning
 *
 * @remarks
 * Re-check these columns and re-run the pruning tests whenever Pi Durable is upgraded.
 *
 * @module
 */
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** Conversation entries; `record` is the entry as JSON and `head` links to the entry before it. */
export const piEntries = sqliteTable('entries', {
  id: integer('id').primaryKey(),
  conversationId: integer('conversation_id').notNull(),
  head: integer('head'),
  record: text('record').notNull(),
})

/** Conversations, one row each. */
export const piConversations = sqliteTable('conversations', {
  id: integer('id').primaryKey(),
})

/** Background tasks; pruning waits while one is running. */
export const piTasks = sqliteTable('tasks', {
  id: integer('id').primaryKey(),
  status: text('status').notNull(),
})

/** Documents (`defineDoc`) and who owns them. */
export const piDocuments = sqliteTable('documents', {
  id: integer('id').primaryKey(),
  scopeKind: text('scope_kind').notNull(),
  ownerId: integer('owner_id').notNull(),
})

/** Document revisions; every write of a document appends one. */
export const piDocumentRevisions = sqliteTable('document_revisions', {
  documentId: integer('document_id').notNull(),
})

/** The ID and type of every Pi record. */
export const piRecordIds = sqliteTable('record_ids', {
  id: integer('id').primaryKey(),
  recordType: text('record_type').notNull(),
})
