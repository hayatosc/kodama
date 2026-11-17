UPDATE mcp_servers
SET catalog_digest = :catalogDigest,
    catalog_version = :catalogVersion,
    inspected_at = :inspectedAt,
    inspection_error = NULL,
    stale = :stale,
    updated_at = :updatedAt,
    enabled = 1
WHERE server_id = :serverId
  AND revision = :revision;
