UPDATE extraction_checkpoints
SET
  last_entry_id = :lastEntryId,
  revision = :nextRevision,
  updated_at = :updatedAt
WHERE agent_id = :agentId AND revision = :revision;
