UPDATE kodama_memory_jobs
SET status = 'settled', outcome = :outcome, settled_at = :settledAt
WHERE job_id = :jobId;
