SELECT
  id,
  content,
  last_used_at AS lastUsedAt
FROM memory_records
WHERE scope = :scope AND use_count = :useCount;
