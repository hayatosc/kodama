UPDATE credentials
SET
  status = 'needs_reauth',
  lease_id = NULL,
  lease_expires_at = NULL
WHERE credential_id = :credentialId
  AND revision = :revision
  AND lease_id = :leaseId;
