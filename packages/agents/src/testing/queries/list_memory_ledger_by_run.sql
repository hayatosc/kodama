SELECT
  seq,
  at,
  run_id AS runId,
  op_id AS opId,
  actor,
  action,
  target,
  target_id AS targetId,
  detail_json AS detailJson
FROM memory_ledger
WHERE run_id = :runId;
