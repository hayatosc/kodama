-- Long-term memory D1 schema.
-- Times are Unix epoch milliseconds. Writes use plain inserts (never INSERT OR IGNORE on data
-- tables) so a constraint violation fails the statement and rolls back the batch.

CREATE TABLE memory_records (
  id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fact', 'event', 'instruction', 'task')),
  content TEXT NOT NULL,
  search_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'invalid', 'archived')),
  superseded_by TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('remember', 'extraction', 'consolidation', 'shared')),
  source_agent_id TEXT NOT NULL,
  source_entry_from INTEGER,
  source_entry_to INTEGER,
  run_id TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5,
  pinned BOOL NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  overrides TEXT,
  required BOOL NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  observed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX memory_records_by_scope ON memory_records (scope, status, kind, importance);
CREATE INDEX memory_records_by_source ON memory_records (source_agent_id, source_entry_from);
CREATE INDEX memory_records_by_override ON memory_records (overrides) WHERE overrides IS NOT NULL;

CREATE TABLE memory_ops (
  op_id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  op TEXT NOT NULL,
  result_json TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);

CREATE INDEX memory_ops_by_job ON memory_ops (job_id);

CREATE TABLE memory_terms (
  term TEXT NOT NULL,
  record_id TEXT NOT NULL REFERENCES memory_records (id) ON DELETE CASCADE,
  PRIMARY KEY (term, record_id)
);

CREATE INDEX memory_terms_by_record ON memory_terms (record_id);

CREATE TABLE revision_claims (
  target TEXT NOT NULL CHECK (target IN ('record', 'checkpoint', 'skill', 'task')),
  target_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  op_id TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (target, target_id, revision)
);

CREATE INDEX revision_claims_by_time ON revision_claims (claimed_at);

CREATE TABLE scope_revisions (
  scope TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE extraction_checkpoints (
  agent_id TEXT PRIMARY KEY NOT NULL,
  last_entry_id INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE memory_ledger (
  seq INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  at INTEGER NOT NULL,
  run_id TEXT NOT NULL,
  op_id TEXT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL CHECK (target IN ('record', 'skill', 'task')),
  target_id TEXT NOT NULL,
  detail_json TEXT
);

CREATE INDEX memory_ledger_by_target ON memory_ledger (target, target_id, seq);

CREATE TABLE archive_segments (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL,
  first_entry INTEGER NOT NULL,
  last_entry INTEGER NOT NULL,
  entry_count INTEGER NOT NULL,
  r2_prefix TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX archive_segments_start ON archive_segments (agent_id, first_entry);
CREATE INDEX archive_segments_by_time ON archive_segments (agent_id, last_at);

CREATE TABLE skills (
  agent_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  evidence TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, name)
);

CREATE INDEX skills_by_status ON skills (agent_id, status);

CREATE TABLE task_progress (
  agent_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'blocked', 'completed', 'archived')),
  summary TEXT NOT NULL,
  body TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, slug)
);

CREATE INDEX task_progress_by_status ON task_progress (agent_id, status, updated_at);
