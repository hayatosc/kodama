SELECT slug, title, status, summary
FROM task_progress
WHERE agent_id = :agentId AND status IN ('in_progress', 'blocked')
ORDER BY updated_at DESC
LIMIT :limit;
