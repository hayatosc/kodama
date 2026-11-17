SELECT not_before AS notBefore
FROM kodama_memory_jobs
WHERE status = 'queued'
ORDER BY not_before ASC
LIMIT 1;
