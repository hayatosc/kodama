SELECT agent_id AS agentId
FROM credential_grants
WHERE credential_id = :credentialId;
