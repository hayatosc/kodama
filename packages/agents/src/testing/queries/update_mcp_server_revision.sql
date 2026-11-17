UPDATE mcp_servers
SET revision = :revision
WHERE server_id = :serverId;
