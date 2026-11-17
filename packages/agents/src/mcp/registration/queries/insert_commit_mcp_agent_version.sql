INSERT INTO mcp_commits (operation_id, authorized, created_at)
VALUES (
  :operationId,
  EXISTS (
    SELECT 1
    FROM agents
    WHERE agent_id = :agentId
      AND current_version = :currentVersion
  ),
  :createdAt
);
