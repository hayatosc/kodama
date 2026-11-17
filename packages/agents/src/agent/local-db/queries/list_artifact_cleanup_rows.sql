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
WHERE state = 'deleting'
   OR expires_at <= :now
   OR (state = 'uploading' AND created_at <= :uploadBefore)
LIMIT 100;
