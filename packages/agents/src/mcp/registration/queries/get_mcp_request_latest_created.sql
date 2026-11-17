WITH input AS (
  SELECT :serverId::nullable(text) AS serverId
)
SELECT
  mcp_requests.request_id AS requestId,
  mcp_requests.source_agent_id AS sourceAgentId,
  mcp_requests.conversation_id AS conversationId,
  mcp_requests.entry_id AS entryId,
  mcp_requests.submission_id AS submissionId,
  mcp_requests.server_id AS serverId,
  mcp_requests.server_revision AS serverRevision,
  mcp_requests.credential_id AS credentialId,
  mcp_requests.status AS status,
  mcp_requests.name AS name,
  mcp_requests.notified_at AS notifiedAt,
  mcp_requests.expires_at AS expiresAt,
  mcp_requests.created_at AS createdAt
FROM mcp_requests, input
WHERE mcp_requests.source_agent_id = :sourceAgentId
  AND mcp_requests.conversation_id = :conversationId
  AND (input.serverId IS NULL OR mcp_requests.server_id = input.serverId)
ORDER BY mcp_requests.created_at DESC
LIMIT 1;
