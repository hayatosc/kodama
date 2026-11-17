UPDATE skills
SET
  status = :status,
  revision = :nextRevision,
  updated_at = :updatedAt
WHERE agent_id = :agentId AND name = :name AND revision = :revision;
