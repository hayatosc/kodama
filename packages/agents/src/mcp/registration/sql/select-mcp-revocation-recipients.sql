SELECT
  agents.agent_id AS agentId,
  credentials.credential_id AS credentialId,
  agent_config_versions.settings_json AS settingsJson
FROM credentials
INNER JOIN agents
  ON agents.kind = 'working'
INNER JOIN agent_config_versions
  ON agent_config_versions.agent_id = agents.agent_id
  AND agent_config_versions.version = agents.current_version
WHERE credentials.purpose = 'mcp_server'
  AND credentials.status != 'active';
