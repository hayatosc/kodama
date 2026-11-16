UPDATE mcp_intents
SET consumed_at = :now
WHERE intent_id = :intentId;
