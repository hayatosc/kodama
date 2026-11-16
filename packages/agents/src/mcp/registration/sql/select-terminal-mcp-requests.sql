SELECT
  mcp_oauth_transactions.server_id AS txServerId,
  mcp_oauth_transactions.server_revision AS txServerRevision,
  mcp_oauth_transactions.status AS txStatus,
  mcp_oauth_transactions.credential_id AS txCredentialId,
  mcp_requests.request_id AS requestId,
  mcp_requests.server_id AS requestServerId,
  mcp_requests.server_revision AS requestServerRevision
FROM mcp_oauth_transactions
INNER JOIN mcp_requests
  ON mcp_requests.request_id = mcp_oauth_transactions.request_id
WHERE mcp_requests.status = 'awaiting_owner_auth'
  AND mcp_oauth_transactions.status IN ('completed', 'denied', 'reauth_required')
LIMIT 100;
