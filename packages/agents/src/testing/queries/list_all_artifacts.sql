SELECT
  id,
  filename,
  media_type AS mediaType,
  size,
  storage_key AS storageKey,
  state,
  source_task AS sourceTask,
  created_at AS createdAt,
  expires_at AS expiresAt
FROM kodama_artifacts
ORDER BY created_at ASC, id ASC;
