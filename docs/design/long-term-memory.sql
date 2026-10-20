-- Proposed D1 schema for long-term memory (see long-term-memory.md). Not applied yet.
-- Times are Unix epoch milliseconds.

CREATE TABLE memory_records (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fact', 'event', 'instruction', 'task')),
  topic_key TEXT,
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 2000),
  -- Words of topic_key and content from Intl.Segmenter, normalized and joined by spaces:
  -- merged katakana words first, then the original segments that differ (see the design doc).
  -- search_version names the segmentation rules so rows can be re-split later.
  search_text TEXT NOT NULL,
  search_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'superseded', 'invalid', 'archived')),
  superseded_by TEXT,
  origin TEXT NOT NULL
    CHECK (origin IN ('user_request', 'agent_judgment', 'extraction', 'consolidation')),
  source_agent_id TEXT NOT NULL,
  source_generation INTEGER NOT NULL,
  source_entry_from INTEGER,
  source_entry_to INTEGER,
  run_id TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5 CHECK (importance BETWEEN 0 AND 1),
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  observed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  CHECK ((kind IN ('fact', 'instruction')) = (topic_key IS NOT NULL)),
  CHECK ((status = 'superseded') = (superseded_by IS NOT NULL))
);

-- At most one active record per topic: superseding races fail instead of leaving two.
CREATE UNIQUE INDEX memory_records_active_topic
  ON memory_records (scope, kind, topic_key)
  WHERE status = 'active' AND topic_key IS NOT NULL;
CREATE INDEX memory_records_by_scope ON memory_records (scope, status, kind, importance DESC);
CREATE INDEX memory_records_by_source
  ON memory_records (source_agent_id, source_generation, source_entry_from);

-- Text is segmented in the Worker, so FTS5 only splits on the spaces it inserted.
CREATE VIRTUAL TABLE memory_fts USING fts5 (
  search_text,
  content = 'memory_records', content_rowid = 'rowid', tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER memory_records_ai AFTER INSERT ON memory_records BEGIN
  INSERT INTO memory_fts (rowid, search_text) VALUES (new.rowid, new.search_text);
END;
CREATE TRIGGER memory_records_ad AFTER DELETE ON memory_records BEGIN
  INSERT INTO memory_fts (memory_fts, rowid, search_text)
    VALUES ('delete', old.rowid, old.search_text);
END;
CREATE TRIGGER memory_records_au AFTER UPDATE OF search_text ON memory_records BEGIN
  INSERT INTO memory_fts (memory_fts, rowid, search_text)
    VALUES ('delete', old.rowid, old.search_text);
  INSERT INTO memory_fts (rowid, search_text) VALUES (new.rowid, new.search_text);
END;

CREATE TABLE extraction_checkpoints (
  agent_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  last_entry_id INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, generation)
);

CREATE TABLE generations (
  agent_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('active', 'exporting', 'exported', 'switching', 'closed')),
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  config_json TEXT,
  handoff TEXT,
  handoff_search_text TEXT,
  search_version INTEGER,
  archive_prefix TEXT,
  archive_sha256 TEXT,
  entry_count INTEGER,
  byte_size INTEGER,
  compaction_count INTEGER,
  PRIMARY KEY (agent_id, generation)
);
CREATE UNIQUE INDEX generations_one_open
  ON generations (agent_id) WHERE status <> 'closed';

CREATE VIRTUAL TABLE generations_fts USING fts5 (
  handoff_search_text,
  content = 'generations', content_rowid = 'rowid', tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER generations_au AFTER UPDATE OF handoff_search_text ON generations BEGIN
  INSERT INTO generations_fts (generations_fts, rowid, handoff_search_text)
    SELECT 'delete', old.rowid, old.handoff_search_text WHERE old.handoff_search_text IS NOT NULL;
  INSERT INTO generations_fts (rowid, handoff_search_text)
    SELECT new.rowid, new.handoff_search_text WHERE new.handoff_search_text IS NOT NULL;
END;

CREATE TABLE skills (
  scope TEXT NOT NULL,
  name TEXT NOT NULL CHECK (name NOT GLOB '*[^a-z0-9-]*' AND length(name) BETWEEN 1 AND 64),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 1024),
  search_text TEXT NOT NULL,
  search_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'active', 'stale', 'archived')),
  version INTEGER NOT NULL DEFAULT 1,
  r2_key TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope, name)
);
CREATE INDEX skills_by_status ON skills (scope, status, last_used_at);

CREATE VIRTUAL TABLE skills_fts USING fts5 (
  search_text,
  content = 'skills', content_rowid = 'rowid', tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER skills_ai AFTER INSERT ON skills BEGIN
  INSERT INTO skills_fts (rowid, search_text) VALUES (new.rowid, new.search_text);
END;
CREATE TRIGGER skills_au AFTER UPDATE OF search_text ON skills BEGIN
  INSERT INTO skills_fts (skills_fts, rowid, search_text)
    VALUES ('delete', old.rowid, old.search_text);
  INSERT INTO skills_fts (rowid, search_text) VALUES (new.rowid, new.search_text);
END;

CREATE TABLE shared_proposals (
  id TEXT PRIMARY KEY,
  space TEXT NOT NULL,
  target TEXT NOT NULL CHECK (target IN ('record', 'skill')),
  payload_json TEXT NOT NULL,
  source_ids_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  run_id TEXT NOT NULL,
  proposed_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by TEXT,
  reason TEXT
);
CREATE INDEX shared_proposals_pending ON shared_proposals (space, status, proposed_at);

CREATE TABLE memory_ledger (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  run_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL CHECK (target IN ('record', 'skill', 'proposal')),
  target_id TEXT NOT NULL,
  detail_json TEXT
);
CREATE INDEX memory_ledger_by_target ON memory_ledger (target, target_id, seq);
