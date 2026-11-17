UPDATE mcp_requests
SET expires_at = :expiresAt
WHERE request_id = :requestId;
