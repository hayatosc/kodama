SELECT
  r.agent_id AS agentId,
  r.credential_id AS credentialId,
  r.provider,
  a.current_version AS version
FROM agent_credential_refs r
INNER JOIN agents a ON a.agent_id = r.agent_id
WHERE r.credential_id = :credentialId;
