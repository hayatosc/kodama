UPDATE credentials
SET
  lease_expires_at = :leaseExpiresAt,
  revision = :revision,
  status = :status,
  lease_id = :leaseId
WHERE credential_id = :credentialId;
