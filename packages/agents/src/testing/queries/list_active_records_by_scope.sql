SELECT
  id,
  scope,
  kind,
  content,
  origin,
  status
FROM memory_records
WHERE scope = :scope AND status = 'active';
