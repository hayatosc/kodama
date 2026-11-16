UPDATE credentials
SET lease_id = NULL,
    lease_expires_at = NULL
WHERE credential_id = :credentialId
  AND lease_id = :leaseId;
