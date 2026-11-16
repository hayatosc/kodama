SELECT id, content
FROM memory_records
WHERE search_version < :searchVersion
LIMIT :limit;
