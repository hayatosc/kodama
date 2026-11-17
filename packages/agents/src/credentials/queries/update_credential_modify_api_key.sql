UPDATE credentials
SET ciphertext = :ciphertext,
    iv = :iv,
    wrapped_dek = :wrappedDek,
    wrap_iv = :wrapIv,
    revision = :nextRevision,
    fingerprint = :fingerprint,
    last4 = :last4
WHERE credential_id = :credentialId
  AND lease_id = :leaseId
  AND revision = :expectedRevision
  AND lease_expires_at > :now
  AND status = 'active';
