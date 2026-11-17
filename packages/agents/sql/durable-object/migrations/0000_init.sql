-- Durable Object local SQLite schema, next to Pi Durable's tables.
-- Applied synchronously when the object opens. Times are Unix epoch milliseconds.

CREATE TABLE kodama_mcp_calls (
  call_id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('running', 'succeeded', 'failed', 'outcome_unknown')),
  failure TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX kodama_mcp_calls_run ON kodama_mcp_calls (run_id, tool_id);

CREATE TABLE kodama_artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  storage_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('uploading', 'ready', 'deleting')),
  source_task TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX kodama_artifacts_storage_key_unique ON kodama_artifacts (storage_key);
CREATE INDEX kodama_artifacts_expiry ON kodama_artifacts (expires_at);

CREATE TABLE kodama_contact_requests (
  id TEXT PRIMARY KEY NOT NULL,
  source_task TEXT NOT NULL,
  source_entry INTEGER NOT NULL,
  arguments TEXT NOT NULL,
  target_agent_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  content TEXT NOT NULL,
  hop INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('dispatching', 'submitted', 'settled', 'failed')),
  submission_id INTEGER,
  retry_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  created_at INTEGER NOT NULL,
  settled_at INTEGER,
  expires_at INTEGER
);

CREATE UNIQUE INDEX kodama_contact_requests_source_task_unique ON kodama_contact_requests (source_task);
CREATE UNIQUE INDEX kodama_contact_requests_request_id_unique ON kodama_contact_requests (request_id);
CREATE INDEX kodama_contact_requests_pending ON kodama_contact_requests (state, retry_at);
CREATE INDEX kodama_contact_requests_expiry ON kodama_contact_requests (expires_at);

CREATE TABLE kodama_contact_receipts (
  sender_agent_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  submission_id INTEGER NOT NULL,
  result TEXT,
  created_at INTEGER NOT NULL,
  settled_at INTEGER,
  acknowledged_at INTEGER,
  expires_at INTEGER,
  PRIMARY KEY (sender_agent_id, request_id)
);

CREATE INDEX kodama_contact_receipts_submission ON kodama_contact_receipts (submission_id);
CREATE INDEX kodama_contact_receipts_expiry ON kodama_contact_receipts (expires_at);

CREATE TABLE kodama_notifications (
  seq INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('contact', 'schedule', 'mcp', 'outbox', 'approval')),
  source_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  summary TEXT NOT NULL,
  details TEXT,
  artifact_ids TEXT NOT NULL,
  delivery_state TEXT NOT NULL DEFAULT 'dispatched' CHECK (delivery_state IN ('pending', 'dispatched', 'suppressed')),
  deliver_after INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  read_at INTEGER
);

CREATE UNIQUE INDEX kodama_notifications_source ON kodama_notifications (source, source_id);
CREATE INDEX kodama_notifications_unread ON kodama_notifications (read_at, seq);
CREATE INDEX kodama_notifications_expiry ON kodama_notifications (expires_at);
CREATE INDEX kodama_notifications_delivery ON kodama_notifications (delivery_state, deliver_after);

CREATE TABLE kodama_scheduled_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  source_task TEXT NOT NULL,
  source_entry INTEGER NOT NULL,
  arguments TEXT NOT NULL,
  instruction TEXT NOT NULL,
  rule TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'schedule' CHECK (category IN ('followup', 'schedule')),
  followup_hop INTEGER NOT NULL DEFAULT 0,
  session_mode TEXT NOT NULL DEFAULT 'new' CHECK (session_mode IN ('resume', 'new')),
  state TEXT NOT NULL CHECK (state IN ('active', 'paused', 'completed', 'cancelled', 'failed')),
  next_due INTEGER,
  cursor INTEGER,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX kodama_scheduled_tasks_source_task_unique ON kodama_scheduled_tasks (source_task);
CREATE INDEX kodama_scheduled_tasks_due ON kodama_scheduled_tasks (state, next_due);

CREATE TABLE kodama_scheduled_occurrences (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL REFERENCES kodama_scheduled_tasks (id),
  nominal_at INTEGER NOT NULL,
  coalesced_from INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('dispatching', 'submitted', 'settled', 'failed')),
  submission_id INTEGER,
  admission_started BOOL NOT NULL DEFAULT 0 CHECK (admission_started IN (0, 1)),
  retry_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  outcome TEXT,
  settled_at INTEGER
);

CREATE UNIQUE INDEX kodama_scheduled_occurrences_nominal ON kodama_scheduled_occurrences (task_id, nominal_at);
CREATE INDEX kodama_scheduled_occurrences_pending ON kodama_scheduled_occurrences (state, retry_at);

CREATE TABLE kodama_usage (
  seq INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  charged_agent_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'agent', 'system')),
  job_id TEXT,
  credential_id TEXT,
  credential_kind TEXT CHECK (credential_kind IN ('api_key', 'oauth_subscription')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  response_model TEXT,
  status TEXT NOT NULL DEFAULT 'in_flight' CHECK (status IN ('in_flight', 'succeeded', 'failed', 'aborted', 'interrupted')),
  rate_limited BOOL NOT NULL DEFAULT 0 CHECK (rate_limited IN (0, 1)),
  usage_state TEXT NOT NULL DEFAULT 'unknown' CHECK (usage_state IN ('reported', 'partial', 'unknown', 'not_applicable')),
  input INTEGER,
  output INTEGER,
  cache_read INTEGER,
  cache_write INTEGER,
  total_tokens INTEGER,
  reasoning INTEGER,
  cache_write_1h INTEGER,
  input_cost REAL,
  output_cost REAL,
  cache_read_cost REAL,
  cache_write_cost REAL,
  total_cost REAL,
  aggregated_at INTEGER
);

CREATE TABLE kodama_memory_jobs (
  job_id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  priority INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'settled')),
  outcome TEXT CHECK (outcome IN ('persisted', 'declined', 'conflict', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  not_before INTEGER NOT NULL,
  started_at INTEGER,
  created_at INTEGER NOT NULL,
  settled_at INTEGER
);

CREATE INDEX kodama_memory_jobs_next ON kodama_memory_jobs (status, priority, created_at);

CREATE TABLE kodama_remember_turns (
  entry_id INTEGER PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL
);

CREATE TABLE kodama_always_loaded (
  id INTEGER PRIMARY KEY NOT NULL,
  text TEXT NOT NULL,
  revisions_json TEXT NOT NULL,
  skills_json TEXT NOT NULL DEFAULT '[]',
  tasks_json TEXT NOT NULL DEFAULT '[]',
  checked_at INTEGER NOT NULL
);

CREATE TABLE kodama_prune_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  first_entry INTEGER NOT NULL,
  last_entry INTEGER NOT NULL,
  head INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('prepared', 'exported', 'indexed', 'deleted')),
  entry_count INTEGER,
  bytes INTEGER,
  sha256 TEXT,
  first_at INTEGER,
  last_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX kodama_prune_runs_by_state ON kodama_prune_runs (state);

CREATE TABLE kodama_external_data (
  root TEXT PRIMARY KEY NOT NULL,
  reason TEXT NOT NULL,
  contacted_at INTEGER NOT NULL,
  eligible_through INTEGER NOT NULL
);

CREATE TABLE kodama_known_urls (
  root TEXT NOT NULL,
  url TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('owner', 'search', 'page')),
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (root, url)
);

CREATE INDEX kodama_known_urls_by_age ON kodama_known_urls (root, granted_at);

CREATE TABLE kodama_event_inbox (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('user', 'webhook', 'schedule', 'peer', 'mcp', 'approval')),
  session_mode TEXT NOT NULL DEFAULT 'resume' CHECK (session_mode IN ('resume', 'new')),
  when_busy TEXT NOT NULL DEFAULT 'followUp' CHECK (when_busy IN ('followUp', 'steer', 'interrupt')),
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'admitted', 'settled', 'failed')),
  batch_request_id TEXT,
  submission_id INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  settled_at INTEGER
);

CREATE UNIQUE INDEX kodama_event_inbox_request_id_unique ON kodama_event_inbox (request_id);
CREATE INDEX kodama_event_inbox_pending ON kodama_event_inbox (state, next_retry_at, created_at);
CREATE INDEX kodama_event_inbox_batch ON kodama_event_inbox (state, batch_request_id);

CREATE TABLE kodama_deferred_calls (
  approval_id TEXT PRIMARY KEY NOT NULL,
  tool_name TEXT NOT NULL,
  tool_digest TEXT,
  arguments_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_task TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'approved', 'denied', 'consumed', 'expired')),
  operator_note TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  decided_at INTEGER
);

CREATE UNIQUE INDEX kodama_deferred_calls_source_task_unique ON kodama_deferred_calls (source_task);
CREATE INDEX kodama_deferred_calls_state ON kodama_deferred_calls (state, created_at);
