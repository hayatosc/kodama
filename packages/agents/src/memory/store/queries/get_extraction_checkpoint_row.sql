SELECT
  agent_id AS agentId,
  last_entry_id AS lastEntryId,
  revision,
  updated_at AS updatedAt
FROM extraction_checkpoints
WHERE agent_id = :agentId;
