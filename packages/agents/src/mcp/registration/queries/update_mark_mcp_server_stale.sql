UPDATE mcp_servers
SET stale = 1
WHERE server_id = :serverId
  AND revision = :revision;
