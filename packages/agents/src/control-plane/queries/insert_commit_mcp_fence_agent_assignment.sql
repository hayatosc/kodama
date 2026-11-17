INSERT INTO mcp_commits (operation_id, authorized, created_at)
VALUES (
  :operationId,
  EXISTS (
    SELECT 1
    FROM mcp_assignments m
    INNER JOIN agents a ON a.agent_id = m.agent_id
    WHERE a.kind = 'working'
      AND m.agent_id = :agentId
      AND m.tool_id = :toolId
      AND m.server_id = :serverId
      AND m.server_revision = :serverRevision
      AND m.digest = :digest
      AND m.credential_id = :credentialId
  ),
  :createdAt
);
