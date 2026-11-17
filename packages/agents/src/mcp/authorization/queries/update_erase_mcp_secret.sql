UPDATE credentials
SET
  status = 'revoked',
  ciphertext = NULL,
  iv = NULL,
  wrapped_dek = NULL,
  wrap_iv = NULL,
  lease_id = NULL,
  lease_expires_at = NULL,
  revoked_at = :now
WHERE credential_id = :credentialId
  AND purpose = 'mcp_server';
