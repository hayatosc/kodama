INSERT INTO mcp_oauth_clients (
  registration_id,
  server_id,
  issuer,
  redirect_uri,
  status,
  created_at
)
VALUES (
  :registrationId,
  :serverId,
  :issuer,
  :redirectUri,
  'registering',
  :createdAt
);
