UPDATE mcp_servers
SET name = :name,
    endpoint = :endpoint,
    enabled = :enabled,
    revision = :revision,
    catalog_digest = :catalogDigest::nullable(text),
    catalog_version = :catalogVersion,
    updated_at = :updatedAt
WHERE server_id = :serverId;
