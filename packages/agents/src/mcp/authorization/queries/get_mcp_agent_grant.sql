SELECT
  agents.agent_id AS agentId
FROM agents
INNER JOIN credential_grants
  ON credential_grants.agent_id = agents.agent_id
WHERE agents.agent_id = :agentId
  AND agents.kind = 'working'
  AND agents.status = 'active'
  AND credential_grants.credential_id = :credentialId
LIMIT 1;
