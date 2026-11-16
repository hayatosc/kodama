SELECT DISTINCT scope
FROM memory_records
WHERE updated_at >= :since
ORDER BY scope ASC
LIMIT :limit;
