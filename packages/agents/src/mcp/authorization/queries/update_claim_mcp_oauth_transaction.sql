UPDATE mcp_oauth_transactions
SET status = :status
WHERE transaction_id = :transactionId
  AND status = 'pending';
