WITH input AS (
  SELECT :before::nullable(int) AS before
)
SELECT
  v.agent_id AS agentId,
  v.version,
  v.settings_json AS settingsJson,
  v.schema_version AS schemaVersion,
  v.source,
  v.comment,
  v.created_at AS createdAt
FROM agent_config_versions v
CROSS JOIN input
WHERE v.agent_id = :agentId
  AND (input.before IS NULL OR v.version < input.before)
ORDER BY v.version DESC
LIMIT :limit;
