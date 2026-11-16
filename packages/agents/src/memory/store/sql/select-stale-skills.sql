WITH input AS (
  SELECT :before::int AS before_at
)
SELECT
  s.agent_id AS agentId,
  s.name,
  s.description,
  s.body,
  s.status,
  s.evidence,
  s.revision,
  s.use_count AS useCount,
  s.last_used_at AS lastUsedAt,
  s.created_at AS createdAt,
  s.updated_at AS updatedAt
FROM skills AS s
CROSS JOIN input
WHERE s.status = 'active'
  AND s.updated_at < input.before_at
  AND (s.last_used_at IS NULL OR s.last_used_at < input.before_at)
LIMIT :limit;
