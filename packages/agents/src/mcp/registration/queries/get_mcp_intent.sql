SELECT
  intent_id AS intentId,
  source_agent_id AS sourceAgentId,
  conversation_id AS conversationId,
  entry_id AS entryId,
  submission_id AS submissionId,
  instruction_json AS instructionJson,
  expires_at AS expiresAt,
  consumed_at AS consumedAt
FROM mcp_intents
WHERE intent_id = :intentId
LIMIT 1;
