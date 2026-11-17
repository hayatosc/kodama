UPDATE agents
SET current_version = :version, updated_at = :updatedAt
WHERE agent_id = :agentId AND current_version = :expected;
