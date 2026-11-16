UPDATE mcp_requests
SET status = 'discovered'
WHERE request_id = :requestId;
