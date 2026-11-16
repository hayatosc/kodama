INSERT INTO mcp_commits (operation_id, authorized, created_at)
VALUES (
  :operationId,
  EXISTS (
    SELECT 1
    FROM mcp_proposals
    WHERE proposal_id = :proposalId
      AND source_agent_id = :sourceAgentId
      AND conversation_id = :conversationId
  ),
  :createdAt
);
