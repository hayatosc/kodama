SELECT
  agent_id AS agentId,
  last_seq AS lastSeq,
  updated_at AS updatedAt,
  caught_up AS caughtUp
FROM usage_ingestion
WHERE agent_id = :agentId;
