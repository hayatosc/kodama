SELECT
  server_id AS serverId,
  short_id AS shortId,
  name,
  endpoint,
  enabled,
  revision,
  catalog_digest AS catalogDigest,
  catalog_version AS catalogVersion,
  inspected_at AS inspectedAt,
  inspection_error AS inspectionError,
  stale,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM mcp_servers
WHERE name = :name;
