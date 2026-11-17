DELETE FROM credential_grants
WHERE credential_id = :credentialId
RETURNING
  credential_id AS credentialId,
  agent_id AS agentId;
