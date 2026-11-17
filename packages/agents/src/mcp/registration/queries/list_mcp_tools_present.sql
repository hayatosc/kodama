SELECT
  tool_id AS toolId,
  server_id AS serverId,
  remote_name AS remoteName,
  model_name AS modelName,
  server_revision AS serverRevision,
  digest,
  definition_json AS definitionJson,
  rejection,
  present
FROM mcp_tools
WHERE server_id = :serverId
  AND present = 1;
