UPDATE skills
SET use_count = :nextUseCount, last_used_at = :lastUsedAt
WHERE agent_id = :agentId AND name = :name;
