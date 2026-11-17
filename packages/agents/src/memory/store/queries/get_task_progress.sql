SELECT
  agent_id AS agentId,
  slug,
  title,
  status,
  summary,
  body,
  revision,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM task_progress
WHERE agent_id = :agentId AND slug = :slug;
