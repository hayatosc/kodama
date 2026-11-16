UPDATE mcp_servers
SET enabled = 0,
    revision = :nextRevision,
    updated_at = :updatedAt
WHERE server_id = :serverId
  AND revision = :expectedRevision;
