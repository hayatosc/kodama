SELECT
  id,
  scope,
  kind,
  content,
  status,
  origin,
  source_agent_id AS sourceAgentId
FROM memory_records
WHERE content = :content;
