SELECT
  credentials.credential_id AS credentialId,
  credentials.status AS status,
  credentials.mcp_auth_state AS mcpAuthState,
  credentials.revision AS revision
FROM credentials
INNER JOIN agents
  ON agents.agent_id = :agentId
  AND agents.kind = 'working'
WHERE credentials.credential_id = :credentialId
  AND credentials.purpose = 'mcp_server'
LIMIT 1;
