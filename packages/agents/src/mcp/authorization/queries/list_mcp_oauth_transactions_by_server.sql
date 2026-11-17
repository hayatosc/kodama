SELECT
  transaction_id AS transactionId,
  status,
  expires_at AS expiresAt
FROM mcp_oauth_transactions
WHERE server_id = :serverId
LIMIT 100;
