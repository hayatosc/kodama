-- Proposed D1 schema for long-term memory (see long-term-memory.md). Not applied yet.
-- Times are Unix epoch milliseconds. Every write uses plain INSERT, never INSERT OR IGNORE:
-- a constraint violation must fail the statement so that the whole batch() rolls back.

CREATE TABLE memory_records (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope GLOB 'agent:*' OR scope GLOB 'shared:*'),
  kind TEXT NOT NULL CHECK (kind IN ('fact', 'event', 'instruction', 'task')),
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 2000),
  -- Words of content from Intl.Segmenter, normalized and joined by spaces:
  -- merged katakana words first, then the original segments that differ (see the design doc).
  -- search_version names the segmentation rules so rows can be re-split later.
  search_text TEXT NOT NULL,
  search_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'superseded', 'invalid', 'archived')),
  superseded_by TEXT,
  origin TEXT NOT NULL
    CHECK (origin IN ('user_request', 'agent_judgment', 'extraction', 'consolidation', 'proposal')),
  source_agent_id TEXT NOT NULL,
  -- Newest source entry. A candidate may supersede a record of the same source agent only when
  -- its own source_entry_to is greater (see the design doc, "Freshness").
  source_entry_from INTEGER,
  source_entry_to INTEGER,
  run_id TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5 CHECK (importance BETWEEN 0 AND 1),
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  -- For an agent record: the ID of a shared record it replaces for this agent. Not a foreign key.
  overrides TEXT,
  -- A shared instruction or fact that agent records cannot override.
  required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
  -- Working agents update use_count and last_used_at; they never change revision.
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  observed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- Incremented on every status or content change; writes compare it with the value they read.
  revision INTEGER NOT NULL DEFAULT 1,
  CHECK ((status = 'superseded') = (superseded_by IS NOT NULL)),
  CHECK (overrides IS NULL OR scope GLOB 'agent:*'),
  CHECK (required = 0 OR (scope GLOB 'shared:*' AND kind IN ('fact', 'instruction')))
);

CREATE INDEX memory_records_by_scope ON memory_records (scope, status, kind, importance DESC);
CREATE INDEX memory_records_by_source
  ON memory_records (source_agent_id, source_entry_from);
CREATE INDEX memory_records_by_override ON memory_records (overrides) WHERE overrides IS NOT NULL;

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

-- One row per applied write operation. The batch that applies an operation inserts its row, so a
-- replay finds the row and returns result_json without touching any record.
CREATE TABLE memory_ops (
  op_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  op TEXT NOT NULL,
  result_json TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);
CREATE INDEX memory_ops_by_job ON memory_ops (job_id);

-- Incremented in the same batch as any change to a scope's active instructions, facts, or
-- skills. Agents compare it with the revision of their always-loaded copy.
CREATE TABLE scope_revisions (
  scope TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Pi never reuses entry IDs, so one checkpoint per agent covers its whole life.
CREATE TABLE extraction_checkpoints (
  agent_id TEXT PRIMARY KEY,
  last_entry_id INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

-- One row per archived range of entries in R2. Written by the agent's pruning code, not by a
-- model, and kept as long as the R2 object exists.
CREATE TABLE archive_segments (
  id TEXT PRIMARY KEY, -- '<agentId>/<first>-<last>'
  agent_id TEXT NOT NULL,
  first_entry INTEGER NOT NULL,
  last_entry INTEGER NOT NULL,
  entry_count INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  -- 1 once extraction has covered this range; extraction may read it from R2 after pruning.
  extracted INTEGER NOT NULL DEFAULT 0 CHECK (extracted IN (0, 1)),
  created_at INTEGER NOT NULL,
  UNIQUE (agent_id, first_entry),
  CHECK (first_entry <= last_entry)
);

-- Searchable text of archived entries ('text') and the segment summary ('summary'). byte_start
-- and byte_end locate the entries in the segment's JSONL object for an R2 range read.
CREATE TABLE archive_chunks (
  id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL REFERENCES archive_segments (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'summary')),
  first_entry INTEGER NOT NULL,
  last_entry INTEGER NOT NULL,
  byte_start INTEGER NOT NULL,
  byte_end INTEGER NOT NULL,
  search_text TEXT NOT NULL,
  search_version INTEGER NOT NULL
);
CREATE INDEX archive_chunks_by_segment ON archive_chunks (segment_id, first_entry);
CREATE VIRTUAL TABLE archive_fts USING fts5 (
  search_text,
  content = 'archive_chunks', content_rowid = 'rowid', tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER archive_chunks_ai AFTER INSERT ON archive_chunks BEGIN
  INSERT INTO archive_fts (rowid, search_text) VALUES (new.rowid, new.search_text);
END;
CREATE TRIGGER archive_chunks_ad AFTER DELETE ON archive_chunks BEGIN
  INSERT INTO archive_fts (archive_fts, rowid, search_text)
    VALUES ('delete', old.rowid, old.search_text);
END;
CREATE TRIGGER archive_chunks_au AFTER UPDATE OF search_text ON archive_chunks BEGIN
  INSERT INTO archive_fts (archive_fts, rowid, search_text)
    VALUES ('delete', old.rowid, old.search_text);
  INSERT INTO archive_fts (rowid, search_text) VALUES (new.rowid, new.search_text);
END;

CREATE TABLE skills (
  scope TEXT NOT NULL CHECK (scope GLOB 'agent:*' OR scope GLOB 'shared:*'),
  name TEXT NOT NULL CHECK (name NOT GLOB '*[^a-z0-9-]*' AND length(name) BETWEEN 1 AND 64),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 1024),
  status TEXT NOT NULL CHECK (status IN ('proposed', 'active', 'stale', 'archived')),
  -- R2 directory, overwritten in place on update: skills/<scope>/<name>/
  r2_key TEXT NOT NULL,
  -- SHA-256 over the sorted list of each path and its file's SHA-256.
  content_sha256 TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  evidence_json TEXT NOT NULL,
  -- For an agent skill that overrides a shared one: '<scope>/<name>@<content_sha256>'.
  based_on TEXT,
  -- For an agent skill merged into a shared one: '<scope>/<name>'.
  absorbed_into TEXT,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope, name),
  CHECK (absorbed_into IS NULL OR (scope GLOB 'agent:*' AND status = 'archived'))
);
CREATE INDEX skills_by_status ON skills (scope, status);
CREATE INDEX skills_by_name ON skills (name, status);

-- A skill update recorded before any file is overwritten. The before and after files are in R2
-- at skills/.blobs/<sha256>, so a 'pending' write can be finished by copying the after files again.
CREATE TABLE skill_writes (
  op_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  name TEXT NOT NULL,
  base_revision INTEGER,
  -- [{ path, before_sha256, after_sha256 }]; NULL before_sha256 adds a file, NULL after removes it.
  files_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX skill_writes_pending ON skill_writes (status, created_at);

-- Uses per agent, so shared skills can be curated by who still uses them.
CREATE TABLE skill_usage (
  scope TEXT NOT NULL,
  name TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER NOT NULL,
  PRIMARY KEY (scope, name, agent_id),
  FOREIGN KEY (scope, name) REFERENCES skills (scope, name) ON DELETE CASCADE
);
CREATE INDEX skill_usage_by_agent ON skill_usage (agent_id, last_used_at);

-- 'accepted' means accepted and not yet applied; the memory agent applies every accepted row.
CREATE TABLE shared_proposals (
  id TEXT PRIMARY KEY,
  space TEXT NOT NULL,
  target TEXT NOT NULL CHECK (target IN ('record', 'skill')),
  -- For a record: the ID of the record it replaces, or '<scope>' for a new one;
  -- for a skill: '<scope>/<name>'.
  target_key TEXT NOT NULL,
  -- Revision of the target the proposal was written against; NULL when the target is new.
  base_revision INTEGER,
  -- Concrete operations applied by code: record contents, or skill files already in R2 as blobs.
  payload_json TEXT NOT NULL,
  source_ids_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'applied', 'rejected', 'conflict')),
  run_id TEXT NOT NULL,
  proposed_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by TEXT,
  reason TEXT,
  applied_at INTEGER,
  CHECK ((status = 'pending') = (decided_at IS NULL)),
  CHECK ((status = 'applied') = (applied_at IS NOT NULL))
);
CREATE INDEX shared_proposals_by_status ON shared_proposals (status, space, proposed_at);

CREATE TABLE memory_ledger (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  run_id TEXT NOT NULL,
  op_id TEXT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL CHECK (target IN ('record', 'skill', 'proposal')),
  target_id TEXT NOT NULL,
  -- For a skill change: [{ path, before_sha256, after_sha256 }]. Blobs referenced by retained
  -- ledger rows are kept in R2, so one change can be rolled back.
  detail_json TEXT
);
CREATE INDEX memory_ledger_by_target ON memory_ledger (target, target_id, seq);
