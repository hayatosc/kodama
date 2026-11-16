UPDATE agents
SET applied_version = :version
WHERE agent_id = :agentId
  AND applied_version < :appliedCeiling
  AND current_version >= :desiredFloor;
