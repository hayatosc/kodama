UPDATE mcp_requests
SET status = 'awaiting_owner_auth'
WHERE source_agent_id = :sourceAgentId
  AND entry_id = :entryId
  AND conversation_id = :conversationId;
