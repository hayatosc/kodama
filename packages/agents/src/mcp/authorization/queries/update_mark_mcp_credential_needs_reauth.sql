UPDATE credentials
SET
  status = 'needs_reauth',
  mcp_auth_state = :reason,
  lease_id = NULL,
  lease_expires_at = NULL
WHERE credential_id = :credentialId
  AND status = 'active'
  AND revision = :revision
  AND lease_id = :leaseId;
