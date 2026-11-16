UPDATE memory_records
SET use_count = :nextUseCount, last_used_at = :lastUsedAt
WHERE id = :id;
