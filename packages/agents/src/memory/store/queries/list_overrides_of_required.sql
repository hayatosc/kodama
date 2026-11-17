SELECT
  id,
  revision,
  scope,
  source_agent_id AS sourceAgentId
FROM memory_records
WHERE status = 'active'
  AND overrides IN (
    SELECT id FROM memory_records WHERE required = 1 AND status = 'active'
  )
LIMIT :limit;
