UPDATE kodama_artifacts
SET
  storage_key = :storageKey,
  expires_at = :expiresAt
WHERE id = :id;
