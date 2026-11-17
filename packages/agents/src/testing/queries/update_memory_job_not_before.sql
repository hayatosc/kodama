UPDATE kodama_memory_jobs
SET not_before = :notBefore
WHERE job_id = :jobId;
