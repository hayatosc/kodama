SELECT last_entry_id AS lastEntryId
FROM extraction_checkpoints
WHERE agent_id = :agentId;
