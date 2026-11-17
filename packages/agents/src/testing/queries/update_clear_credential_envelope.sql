UPDATE credentials
SET
  status = :status,
  ciphertext = NULL,
  iv = NULL,
  wrapped_dek = NULL,
  wrap_iv = NULL
WHERE credential_id = :credentialId;
