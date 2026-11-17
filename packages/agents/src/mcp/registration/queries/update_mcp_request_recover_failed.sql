UPDATE mcp_requests
SET status = 'failed'
WHERE request_id = :requestId
  AND status = 'awaiting_owner_auth';
