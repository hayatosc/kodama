SELECT name, description
FROM skills
WHERE agent_id = :agentId AND status = 'active'
ORDER BY COALESCE(last_used_at, updated_at) DESC
LIMIT :limit;
