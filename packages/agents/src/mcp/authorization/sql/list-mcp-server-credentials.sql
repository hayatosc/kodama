SELECT
  credential_id AS credentialId,
  kind,
  status,
  expires_at AS expiresAt,
  mcp_auth_state AS authState,
  revision
FROM credentials
WHERE provider = :serverId
  AND purpose = 'mcp_server'
  AND kind IN ('mcp_bearer', 'mcp_oauth');
