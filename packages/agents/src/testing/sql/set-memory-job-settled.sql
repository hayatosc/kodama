UPDATE kodama_memory_jobs
SET status = 'settled', outcome = :outcome
WHERE job_id = :jobId;
