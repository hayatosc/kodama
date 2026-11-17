INSERT INTO mcp_commits (operation_id, authorized, created_at)
VALUES (
  :operationId,
  EXISTS (
    SELECT 1
    FROM mcp_intents
    WHERE intent_id = :intentId
      AND source_agent_id = :sourceAgentId
      AND conversation_id = :conversationId
      AND submission_id = :submissionId
      AND instruction_json = :instructionJson
      AND expires_at > :now
      AND consumed_at IS NULL
  ),
  :createdAt
);
