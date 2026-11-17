UPDATE kodama_artifacts
SET expires_at = :expiresAt
WHERE id = :id;
