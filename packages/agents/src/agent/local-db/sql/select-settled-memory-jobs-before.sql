SELECT job_id AS jobId
FROM kodama_memory_jobs
WHERE status = 'settled' AND settled_at <= :before
LIMIT 500;
