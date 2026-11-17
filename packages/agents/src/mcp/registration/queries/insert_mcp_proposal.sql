INSERT INTO mcp_proposals (
  proposal_id,
  request_id,
  source_agent_id,
  conversation_id,
  server_id,
  server_revision,
  catalog_digest,
  credential_id,
  agent_id,
  tool_ids_json,
  expires_at
)
VALUES (
  :proposalId,
  :requestId,
  :sourceAgentId,
  :conversationId,
  :serverId,
  :serverRevision,
  :catalogDigest,
  :credentialId,
  :agentId,
  :toolIdsJson,
  :expiresAt
);
