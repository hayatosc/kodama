WITH input AS (
  SELECT :cursor::nullable(text) AS cursor
)
SELECT
  a.agent_id AS agentId,
  a.display_name AS displayName,
  a.slug,
  v.settings_json AS settingsJson
FROM agents a
INNER JOIN agent_config_versions v
  ON v.agent_id = a.agent_id
  AND v.version = a.current_version
CROSS JOIN input
WHERE a.kind = 'working'
  AND a.status = 'active'
  AND (input.cursor IS NULL OR a.agent_id > input.cursor)
ORDER BY a.agent_id
LIMIT 51;
