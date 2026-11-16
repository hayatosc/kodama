DELETE FROM credential_grants
WHERE credential_id = :credentialId
  AND agent_id = :agentId;
