UPDATE credentials
SET
  status = 'needs_reauth',
  mcp_auth_state = :reason
WHERE credential_id = :credentialId
  AND provider = :serverId
  AND purpose = 'mcp_server'
  AND status = 'active'
  AND revision = :revision;
