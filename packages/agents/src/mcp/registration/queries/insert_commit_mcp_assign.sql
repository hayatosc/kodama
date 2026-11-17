INSERT INTO mcp_commits (operation_id, authorized, created_at)
VALUES (
  :operationId,
  EXISTS (
    SELECT 1
    FROM mcp_servers
    WHERE server_id = :serverId
      AND enabled = 1
      AND revision = :revision
      AND catalog_version = :catalogVersion
  )
  AND EXISTS (
    SELECT 1
    FROM agents
    WHERE agent_id = :agentId
      AND status = 'active'
      AND current_version = :currentVersion
  )
  AND EXISTS (
    SELECT 1
    FROM credentials
    WHERE credential_id = :credentialId
      AND status = 'active'
  ),
  :createdAt
);
