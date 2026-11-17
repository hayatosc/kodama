INSERT INTO agent_config_versions (agent_id, version, settings_json, schema_version, source, comment, created_at)
VALUES (:agentId, :version, :settingsJson, :schemaVersion, :source, :comment, :createdAt);
