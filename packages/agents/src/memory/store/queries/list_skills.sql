SELECT
  agent_id AS agentId,
  name,
  description,
  body,
  status,
  evidence,
  revision,
  use_count AS useCount,
  last_used_at AS lastUsedAt,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM skills
WHERE agent_id = :agentId
ORDER BY name ASC;
