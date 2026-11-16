UPDATE mcp_servers
SET enabled = :enabled::integer
WHERE server_id = :serverId;
