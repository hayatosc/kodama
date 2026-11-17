SELECT
  agent_id AS agentId,
  version,
  settings_json AS settingsJson,
  schema_version AS schemaVersion,
  source,
  comment,
  created_at AS createdAt
FROM agent_config_versions
WHERE agent_id = :agentId AND version = :version;
