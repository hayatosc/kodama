UPDATE task_progress
SET
  status = 'archived',
  revision = :nextRevision,
  updated_at = :updatedAt
WHERE agent_id = :agentId AND slug = :slug AND revision = :revision;
