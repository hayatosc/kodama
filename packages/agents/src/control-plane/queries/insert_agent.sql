INSERT INTO agents (
  agent_id,
  object_name,
  kind,
  display_name,
  slug,
  status,
  current_version,
  created_at,
  updated_at
)
VALUES (
  :agentId,
  :objectName,
  :kind,
  :displayName,
  :slug::nullable(text),
  :status,
  :currentVersion,
  :createdAt,
  :updatedAt
);
