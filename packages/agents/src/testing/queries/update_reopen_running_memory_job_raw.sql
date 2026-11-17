UPDATE kodama_memory_jobs
SET status = 'running', outcome = NULL, settled_at = NULL
WHERE job_id = :jobId;
