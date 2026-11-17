UPDATE agents
SET status = :status, updated_at = :updatedAt
WHERE agent_id = :agentId AND status = 'provisioning';
