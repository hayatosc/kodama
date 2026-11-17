SELECT
  seq,
  op_id AS opId,
  at,
  source,
  action,
  target_kind AS targetKind,
  target_id AS targetId,
  detail_json AS detailJson
FROM audit_log
WHERE target_id = :targetId
ORDER BY seq ASC;
