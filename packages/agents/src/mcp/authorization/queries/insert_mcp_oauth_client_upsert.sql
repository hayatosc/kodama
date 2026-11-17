INSERT INTO mcp_oauth_clients (
  registration_id,
  server_id,
  issuer,
  redirect_uri,
  metadata_json,
  secret_id,
  status,
  created_at
)
VALUES (
  :registrationId,
  :serverId,
  :issuer,
  :redirectUri,
  :metadataJson,
  :secretId,
  'ready',
  :createdAt
)
ON CONFLICT (server_id, issuer, redirect_uri) DO UPDATE SET
  registration_id = excluded.registration_id,
  metadata_json = excluded.metadata_json,
  secret_id = excluded.secret_id,
  status = excluded.status,
  created_at = excluded.created_at;
