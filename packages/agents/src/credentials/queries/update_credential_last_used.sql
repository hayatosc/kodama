UPDATE credentials
SET last_used_at = :at
WHERE credential_id = :credentialId
  AND EXISTS (
    SELECT 1
    FROM usage_ingestion
    WHERE agent_id = :agentId AND last_seq = :after
  )
  AND (last_used_at IS NULL OR last_used_at < :atMax);
