UPDATE mcp_requests
SET status = 'failed'
WHERE expires_at < :now
  AND status IN ('awaiting_endpoint', 'registered_unverified', 'awaiting_owner_auth')
  AND (
    status != 'awaiting_owner_auth'
    OR NOT EXISTS (
      SELECT 1
      FROM mcp_oauth_transactions
      WHERE mcp_oauth_transactions.request_id = mcp_requests.request_id
        AND mcp_oauth_transactions.server_id = mcp_requests.server_id
        AND mcp_oauth_transactions.server_revision = mcp_requests.server_revision
        AND mcp_oauth_transactions.status = 'completed'
        AND mcp_oauth_transactions.credential_id IS NOT NULL
        AND mcp_oauth_transactions.credential_id != ''
    )
  );
