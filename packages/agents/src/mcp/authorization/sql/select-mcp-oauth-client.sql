SELECT
  registration_id AS registrationId,
  server_id AS serverId,
  issuer,
  redirect_uri AS redirectUri,
  metadata_json AS metadataJson,
  secret_id AS secretId,
  status,
  created_at AS createdAt
FROM mcp_oauth_clients
WHERE server_id = :serverId
  AND issuer = :issuer
  AND redirect_uri = :redirectUri
LIMIT 1;
