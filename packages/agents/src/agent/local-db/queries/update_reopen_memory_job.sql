UPDATE kodama_memory_jobs
SET status = 'queued', outcome = NULL, settled_at = NULL, not_before = :notBefore
WHERE job_id = :jobId AND status = 'settled';
