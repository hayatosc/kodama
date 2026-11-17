UPDATE agents
SET
  current_version = :currentVersion,
  applied_version = :appliedVersion
WHERE agent_id = :agentId;
