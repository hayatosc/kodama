SELECT
  credential_id AS credentialId,
  agent_id AS agentId
FROM credential_grants
WHERE credential_id = :credentialId
  AND agent_id = :agentId;
