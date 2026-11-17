SELECT
  request_id AS requestId,
  source_agent_id AS sourceAgentId,
  conversation_id AS conversationId,
  entry_id AS entryId,
  submission_id AS submissionId,
  server_id AS serverId,
  server_revision AS serverRevision,
  credential_id AS credentialId,
  status,
  name,
  notified_at AS notifiedAt,
  expires_at AS expiresAt,
  created_at AS createdAt
FROM mcp_requests
WHERE request_id = :requestId
  AND source_agent_id = :agentId
LIMIT 1;
