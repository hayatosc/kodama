SELECT
  job_id AS jobId,
  kind,
  priority,
  payload_json AS payloadJson,
  status,
  outcome,
  attempts,
  not_before AS notBefore,
  started_at AS startedAt,
  created_at AS createdAt,
  settled_at AS settledAt
FROM kodama_memory_jobs
WHERE job_id = :jobId;
