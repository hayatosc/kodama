WITH input AS (
  SELECT
    :kind::nullable(text) AS kind,
    :status::nullable(text) AS status
)
SELECT
  a.agent_id AS agentId,
  a.object_name AS objectName,
  a.kind,
  a.display_name AS displayName,
  a.slug,
  a.status,
  a.purge_state AS purgeState,
  a.current_version AS currentVersion,
  a.applied_version AS appliedVersion,
  a.created_at AS createdAt,
  a.updated_at AS updatedAt
FROM agents a
CROSS JOIN input
WHERE (input.kind IS NULL OR a.kind = input.kind)
  AND (input.status IS NULL OR a.status = input.status)
ORDER BY a.created_at DESC, a.agent_id DESC;
