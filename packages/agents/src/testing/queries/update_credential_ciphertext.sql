UPDATE credentials
SET ciphertext = :ciphertext
WHERE credential_id = :credentialId;
