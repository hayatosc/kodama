SELECT
  proposal_id AS proposalId,
  request_id AS requestId,
  source_agent_id AS sourceAgentId,
  conversation_id AS conversationId,
  server_id AS serverId,
  server_revision AS serverRevision,
  catalog_digest AS catalogDigest,
  credential_id AS credentialId,
  agent_id AS agentId,
  tool_ids_json AS toolIdsJson,
  expires_at AS expiresAt
FROM mcp_proposals
WHERE proposal_id = :proposalId
LIMIT 1;
