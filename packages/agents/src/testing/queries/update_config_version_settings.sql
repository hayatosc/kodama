UPDATE agent_config_versions
SET settings_json = :settingsJson
WHERE agent_id = :agentId;
