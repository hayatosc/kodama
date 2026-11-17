-- Management D1 schema.
-- Times are Unix epoch milliseconds; IDs are lowercase UUID text.

CREATE TABLE agents (
  agent_id TEXT PRIMARY KEY NOT NULL,
  object_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('working', 'dedicated')),
  display_name TEXT NOT NULL,
  slug TEXT,
  status TEXT NOT NULL CHECK (status IN ('provisioning', 'active', 'pausing', 'paused', 'archived', 'deleting', 'deleted')),
  purge_state TEXT CHECK (purge_state IN ('management', 'memory', 'archive', 'object', 'done')),
  current_version INTEGER NOT NULL,
  applied_version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX agents_object_name_unique ON agents (object_name);
CREATE UNIQUE INDEX agents_slug_unique ON agents (slug);
CREATE INDEX agents_by_status ON agents (status, created_at);

CREATE TABLE agent_config_versions (
  agent_id TEXT NOT NULL REFERENCES agents (agent_id),
  version INTEGER NOT NULL,
  settings_json TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('operator', 'system')),
  comment TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, version)
);

CREATE TABLE mcp_servers (
  server_id TEXT PRIMARY KEY NOT NULL,
  short_id TEXT NOT NULL,
  name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  enabled BOOL NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1,
  catalog_digest TEXT,
  catalog_version INTEGER NOT NULL DEFAULT 0,
  inspected_at INTEGER,
  inspection_error TEXT,
  stale BOOL NOT NULL DEFAULT 0 CHECK (stale IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX mcp_servers_short_id_unique ON mcp_servers (short_id);
CREATE UNIQUE INDEX mcp_servers_endpoint_unique ON mcp_servers (endpoint);

CREATE TABLE mcp_tools (
  tool_id TEXT PRIMARY KEY NOT NULL,
  server_id TEXT NOT NULL REFERENCES mcp_servers (server_id),
  remote_name TEXT NOT NULL,
  model_name TEXT NOT NULL,
  server_revision INTEGER NOT NULL,
  digest TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  rejection TEXT,
  present BOOL NOT NULL DEFAULT 1 CHECK (present IN (0, 1))
);

CREATE UNIQUE INDEX mcp_tools_model_name_unique ON mcp_tools (model_name);
CREATE UNIQUE INDEX mcp_tool_remote_name ON mcp_tools (server_id, remote_name);

CREATE TABLE mcp_definitions (
  digest TEXT PRIMARY KEY NOT NULL,
  definition_json TEXT NOT NULL
);

CREATE TABLE credentials (
  credential_id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('api_key', 'oauth_subscription', 'mcp_bearer', 'mcp_oauth', 'mcp_client', 'mcp_transaction')),
  purpose TEXT NOT NULL DEFAULT 'model_provider' CHECK (purpose IN ('model_provider', 'mcp_server')),
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'needs_reauth')),
  mcp_auth_state TEXT CHECK (mcp_auth_state IN ('reauth_required', 'scope_required', 'outcome_unknown')),
  revision INTEGER NOT NULL,
  ciphertext TEXT,
  iv TEXT,
  wrapped_dek TEXT,
  wrap_iv TEXT,
  fingerprint TEXT NOT NULL,
  last4 TEXT NOT NULL,
  lease_id TEXT,
  lease_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  last_used_at INTEGER,
  expires_at INTEGER,
  last_refreshed_at INTEGER,
  refresh_failures INTEGER NOT NULL DEFAULT 0,
  last_refresh_failure_at INTEGER,
  last_refresh_failure_category TEXT CHECK (last_refresh_failure_category IN ('rejected', 'transient', 'malformed', 'failed'))
);

CREATE UNIQUE INDEX credentials_id_provider ON credentials (credential_id, provider);

CREATE TABLE mcp_assignments (
  agent_id TEXT NOT NULL REFERENCES agents (agent_id),
  server_id TEXT NOT NULL REFERENCES mcp_servers (server_id),
  tool_id TEXT NOT NULL REFERENCES mcp_tools (tool_id),
  credential_id TEXT NOT NULL REFERENCES credentials (credential_id),
  digest TEXT NOT NULL,
  server_revision INTEGER NOT NULL,
  PRIMARY KEY (agent_id, tool_id)
);

CREATE INDEX mcp_assignments_credential ON mcp_assignments (credential_id);

CREATE TABLE mcp_intents (
  intent_id TEXT PRIMARY KEY NOT NULL,
  source_agent_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  entry_id INTEGER NOT NULL,
  submission_id TEXT NOT NULL,
  instruction_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE TABLE mcp_requests (
  request_id TEXT PRIMARY KEY NOT NULL,
  source_agent_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  entry_id INTEGER NOT NULL,
  submission_id TEXT NOT NULL,
  server_id TEXT,
  server_revision INTEGER,
  credential_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('awaiting_endpoint', 'registered_unverified', 'awaiting_owner_auth', 'ready_for_discovery', 'discovered', 'failed')),
  name TEXT NOT NULL,
  notified_at INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE mcp_proposals (
  proposal_id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL,
  source_agent_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  server_revision INTEGER NOT NULL,
  catalog_digest TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  tool_ids_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE mcp_commits (
  operation_id TEXT PRIMARY KEY NOT NULL,
  authorized BOOL NOT NULL CHECK (authorized IN (0, 1)),
  created_at INTEGER NOT NULL,
  CONSTRAINT mcp_commit_authorized CHECK (authorized = 1)
);

CREATE TABLE mcp_oauth_transactions (
  request_id TEXT,
  transaction_id TEXT PRIMARY KEY NOT NULL,
  server_id TEXT NOT NULL REFERENCES mcp_servers (server_id),
  server_revision INTEGER NOT NULL,
  state_digest TEXT NOT NULL,
  browser_digest TEXT NOT NULL,
  binding_json TEXT NOT NULL,
  verifier_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'exchanging', 'completed', 'denied', 'reauth_required')),
  credential_id TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX mcp_oauth_transactions_state_digest_unique ON mcp_oauth_transactions (state_digest);

CREATE TABLE mcp_oauth_clients (
  registration_id TEXT PRIMARY KEY NOT NULL,
  server_id TEXT NOT NULL REFERENCES mcp_servers (server_id),
  issuer TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  metadata_json TEXT,
  secret_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('registering', 'ready', 'reauth_required')),
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX mcp_oauth_client_binding ON mcp_oauth_clients (server_id, issuer, redirect_uri);

CREATE TABLE usage_daily (
  bucket TEXT PRIMARY KEY NOT NULL,
  day TEXT NOT NULL,
  charged_agent_id TEXT NOT NULL,
  credential_id TEXT,
  credential_kind TEXT CHECK (credential_kind IN ('api_key', 'oauth_subscription')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'agent', 'system')),
  usage_state TEXT NOT NULL CHECK (usage_state IN ('reported', 'partial', 'unknown', 'not_applicable')),
  attempts INTEGER NOT NULL,
  failed INTEGER NOT NULL,
  rate_limited INTEGER NOT NULL,
  input INTEGER NOT NULL,
  output INTEGER NOT NULL,
  cache_read INTEGER NOT NULL,
  cache_write INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  reasoning INTEGER NOT NULL,
  cache_write_1h INTEGER NOT NULL,
  reasoning_reported INTEGER NOT NULL,
  cache_write_1h_reported INTEGER NOT NULL,
  cost_usd REAL NOT NULL
);

CREATE INDEX usage_daily_by_day_agent ON usage_daily (day, charged_agent_id);

CREATE TABLE usage_ingestion (
  agent_id TEXT PRIMARY KEY NOT NULL,
  last_seq INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  caught_up BOOL NOT NULL DEFAULT 0 CHECK (caught_up IN (0, 1))
);

CREATE TABLE credential_grants (
  credential_id TEXT NOT NULL REFERENCES credentials (credential_id),
  agent_id TEXT NOT NULL REFERENCES agents (agent_id),
  PRIMARY KEY (credential_id, agent_id)
);

CREATE TABLE agent_credential_refs (
  agent_id TEXT NOT NULL REFERENCES agents (agent_id),
  credential_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  PRIMARY KEY (agent_id, provider),
  FOREIGN KEY (credential_id, provider) REFERENCES credentials (credential_id, provider)
);

CREATE INDEX agent_credential_refs_by_credential ON agent_credential_refs (credential_id);

CREATE TABLE system_settings (
  key TEXT PRIMARY KEY NOT NULL CHECK (key IN ('install_id', 'reconcile_cursor', 'usage_sweep_cursor')),
  value_json TEXT NOT NULL
);

CREATE TABLE audit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  op_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('operator', 'system')),
  action TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('agent', 'system')),
  target_id TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX audit_log_op_id_unique ON audit_log (op_id);
CREATE INDEX audit_log_by_target ON audit_log (target_id, seq);
