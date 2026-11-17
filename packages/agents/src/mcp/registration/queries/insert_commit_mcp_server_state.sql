INSERT INTO mcp_commits (operation_id, authorized, created_at)
VALUES (
  :operationId,
  EXISTS (
    SELECT 1
    FROM mcp_servers
    WHERE server_id = :serverId
      AND revision = :revision
      AND catalog_version = :catalogVersion
  ),
  :createdAt
);
