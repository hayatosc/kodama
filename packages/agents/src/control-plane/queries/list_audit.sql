WITH input AS (
  SELECT
    :targetId::nullable(text) AS targetId,
    :before::nullable(int) AS before
)
SELECT
  l.seq,
  l.op_id AS opId,
  l.at,
  l.source,
  l.action,
  l.target_kind AS targetKind,
  l.target_id AS targetId,
  l.detail_json AS detailJson
FROM audit_log l
CROSS JOIN input
WHERE (input.targetId IS NULL OR l.target_id = input.targetId)
  AND (input.before IS NULL OR l.seq < input.before)
ORDER BY l.seq DESC
LIMIT :limit;
