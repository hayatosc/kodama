INSERT INTO kodama_artifacts (
  id, filename, media_type, size, storage_key, state, source_task, created_at, expires_at
) VALUES (
  :id, :filename, :mediaType, :size, :storageKey, :state, :sourceTask, :createdAt, :expiresAt
);
