DELETE FROM kodama_memory_jobs
WHERE job_id IN (SELECT CAST(value AS TEXT) FROM json_each(:idsJson::text));
