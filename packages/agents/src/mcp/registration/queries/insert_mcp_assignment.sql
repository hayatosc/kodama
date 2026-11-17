INSERT INTO mcp_assignments (
  agent_id,
  server_id,
  tool_id,
  credential_id,
  digest,
  server_revision
)
VALUES (
  :agentId,
  :serverId,
  :toolId,
  :credentialId,
  :digest,
  :serverRevision
);
