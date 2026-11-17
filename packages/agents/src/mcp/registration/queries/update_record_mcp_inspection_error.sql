UPDATE mcp_servers
SET inspection_error = :inspectionError
WHERE server_id = :serverId
  AND revision = :revision
  AND catalog_version = :catalogVersion;
