UPDATE mcp_requests
SET
  credential_id = :credentialId,
  status = 'ready_for_discovery'
WHERE request_id = :requestId;
