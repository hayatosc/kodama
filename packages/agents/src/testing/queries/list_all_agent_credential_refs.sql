SELECT
  agent_id AS agentId,
  credential_id AS credentialId,
  provider
FROM agent_credential_refs
ORDER BY agent_id ASC, provider ASC;
