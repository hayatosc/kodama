SELECT DISTINCT scope
FROM memory_records
WHERE updated_at >= :since AND scope > :after
ORDER BY scope ASC
LIMIT :limit;
