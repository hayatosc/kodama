UPDATE credentials
SET
  lease_id = :leaseId::nullable(text),
  lease_expires_at = :leaseExpiresAt::nullable(int)
WHERE credential_id = :credentialId;
