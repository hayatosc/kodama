SELECT content
FROM memory_records
WHERE scope = :scope AND status = 'active';
