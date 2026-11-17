UPDATE agents
SET status = :status
WHERE agent_id = :agentId
RETURNING agent_id AS agentId;
