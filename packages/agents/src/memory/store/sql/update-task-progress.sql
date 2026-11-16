UPDATE task_progress
SET
  title = :title,
  status = :status,
  summary = :summary,
  body = :body,
  updated_at = :updatedAt,
  revision = :nextRevision
WHERE agent_id = :agentId AND slug = :slug AND revision = :revision;
