UPDATE kodama_memory_jobs
SET status = 'running', attempts = :attempts, started_at = :startedAt
WHERE job_id = :jobId;
