UPDATE mcp_oauth_transactions
SET status = 'reauth_required'
WHERE transaction_id = :transactionId
  AND status IN ('pending', 'exchanging');
