INSERT INTO kodama_memory_jobs (
  job_id, kind, priority, payload_json, not_before, created_at
) VALUES (
  :jobId, :kind, :priority, :payloadJson, :notBefore, :createdAt
)
ON CONFLICT (job_id) DO NOTHING;
