UPDATE mcp_requests
SET notified_at = :now
WHERE request_id = :requestId;
