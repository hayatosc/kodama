UPDATE credentials
SET
  ciphertext = :ciphertext,
  iv = :iv,
  wrapped_dek = :wrappedDek,
  wrap_iv = :wrapIv,
  revision = :nextRevision,
  expires_at = :expiresAt,
  fingerprint = :fingerprint,
  lease_id = NULL,
  lease_expires_at = NULL
WHERE credential_id = :credentialId
  AND status = 'active'
  AND revision = :revision
  AND lease_id = :leaseId;
