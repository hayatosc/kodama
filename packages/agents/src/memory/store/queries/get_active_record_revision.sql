SELECT scope, revision
FROM memory_records
WHERE id = :id AND status = 'active';
