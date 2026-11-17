UPDATE skills
SET last_used_at = :lastUsedAt
WHERE agent_id = :agentId AND name = :name;
