UPDATE credentials
SET
  lease_id = :leaseId,
  lease_expires_at = :leaseExpiresAt
WHERE credential_id = :credentialId
  AND purpose = 'mcp_server'
  AND status = 'active'
  AND revision = :revision
  AND lease_id IS NULL;
