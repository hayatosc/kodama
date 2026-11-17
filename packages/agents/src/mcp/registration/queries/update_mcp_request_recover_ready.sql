UPDATE mcp_requests
SET
  status = 'ready_for_discovery',
  credential_id = :credentialId
WHERE request_id = :requestId
  AND status = 'awaiting_owner_auth';
