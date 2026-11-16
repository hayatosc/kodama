SELECT
  credentials.credential_id AS credentialId
FROM credentials
INNER JOIN credential_grants
  ON credential_grants.credential_id = credentials.credential_id
  AND credential_grants.agent_id = :agentId
WHERE credentials.credential_id = :credentialId
  AND credentials.provider = :serverId
  AND credentials.purpose = 'mcp_server'
  AND credentials.status = 'active'
LIMIT 1;
