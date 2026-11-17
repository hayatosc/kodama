UPDATE skills
SET
  description = :description,
  body = :body,
  evidence = :evidence,
  status = :status,
  updated_at = :updatedAt,
  revision = :nextRevision
WHERE agent_id = :agentId AND name = :name AND revision = :revision;
