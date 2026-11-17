SELECT
  agent_id AS agentId,
  object_name AS objectName,
  kind,
  display_name AS displayName,
  slug,
  status,
  purge_state AS purgeState,
  current_version AS currentVersion,
  applied_version AS appliedVersion,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM agents
WHERE object_name = :objectName;
