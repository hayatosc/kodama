UPDATE usage_ingestion
SET last_seq = :through,
    updated_at = :updatedAt,
    caught_up = :caughtUp
WHERE agent_id = :agentId
  AND last_seq = :after;
