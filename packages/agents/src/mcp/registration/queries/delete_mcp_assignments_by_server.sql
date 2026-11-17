DELETE FROM mcp_assignments
WHERE agent_id = :agentId
  AND server_id = :serverId;
