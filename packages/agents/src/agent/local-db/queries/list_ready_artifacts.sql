WITH input AS (
  SELECT :cursor::nullable(text) AS cursor
)
SELECT
  a.id,
  a.filename,
  a.media_type AS mediaType,
  a.size,
  a.storage_key AS storageKey,
  a.state,
  a.source_task AS sourceTask,
  a.created_at AS createdAt,
  a.expires_at AS expiresAt
FROM kodama_artifacts AS a
CROSS JOIN input
WHERE a.state = 'ready'
  AND a.expires_at > :now
  AND (input.cursor IS NULL OR a.id > input.cursor)
ORDER BY a.id ASC
LIMIT :limit;
