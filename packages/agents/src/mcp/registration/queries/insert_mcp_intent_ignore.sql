INSERT OR IGNORE INTO mcp_intents (
  intent_id,
  source_agent_id,
  conversation_id,
  entry_id,
  submission_id,
  instruction_json,
  expires_at
)
VALUES (
  :intentId,
  :sourceAgentId,
  :conversationId,
  :entryId,
  :submissionId,
  :instructionJson,
  :expiresAt
);
