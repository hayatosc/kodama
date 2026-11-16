SELECT scope, COUNT(*) AS records
FROM memory_records
WHERE status = 'active'
GROUP BY scope;
