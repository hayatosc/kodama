SELECT
  agent_id AS agentId,
  server_id AS serverId,
  tool_id AS toolId,
  credential_id AS credentialId,
  digest,
  server_revision AS serverRevision
FROM mcp_assignments
WHERE agent_id = :agentId;
