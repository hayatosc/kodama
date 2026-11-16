SELECT
  op_id AS opId,
  job_id AS jobId,
  op,
  result_json AS resultJson,
  applied_at AS appliedAt
FROM memory_ops
WHERE op_id IN (SELECT CAST(value AS TEXT) FROM json_each(:opIdsJson::text));
