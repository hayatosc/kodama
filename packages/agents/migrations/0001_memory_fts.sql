-- Full-text index over memory_records.search_text, kept in sync by triggers. Drizzle cannot
-- describe FTS5 virtual tables, so this migration is written by hand (drizzle-kit --custom).
-- Text is segmented in the Worker (src/memory/search-text.ts), so FTS5 only splits on the spaces
-- inserted there.
CREATE VIRTUAL TABLE `memory_fts` USING fts5 (
  search_text,
  content = 'memory_records', content_rowid = 'rowid', tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `memory_records_ai` AFTER INSERT ON `memory_records` BEGIN
  INSERT INTO memory_fts (rowid, search_text) VALUES (new.rowid, new.search_text);
END;
--> statement-breakpoint
CREATE TRIGGER `memory_records_ad` AFTER DELETE ON `memory_records` BEGIN
  INSERT INTO memory_fts (memory_fts, rowid, search_text)
    VALUES ('delete', old.rowid, old.search_text);
END;
--> statement-breakpoint
CREATE TRIGGER `memory_records_au` AFTER UPDATE OF search_text ON `memory_records` BEGIN
  INSERT INTO memory_fts (memory_fts, rowid, search_text)
    VALUES ('delete', old.rowid, old.search_text);
  INSERT INTO memory_fts (rowid, search_text) VALUES (new.rowid, new.search_text);
END;
