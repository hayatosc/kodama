UPDATE kodama_memory_jobs
SET started_at = :startedAt
WHERE job_id = :jobId;
