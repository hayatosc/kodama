UPDATE kodama_memory_jobs
SET status = 'queued', not_before = :notBefore
WHERE job_id = :jobId;
