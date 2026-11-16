UPDATE credentials
SET status = 'revoked',
    ciphertext = NULL,
    iv = NULL,
    wrapped_dek = NULL,
    wrap_iv = NULL,
    revoked_at = :revokedAt,
    lease_id = NULL,
    lease_expires_at = NULL
WHERE credential_id = :credentialId
  AND status != 'revoked';
