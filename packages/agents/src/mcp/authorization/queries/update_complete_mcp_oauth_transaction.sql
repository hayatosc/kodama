UPDATE mcp_oauth_transactions
SET
  status = 'completed',
  credential_id = :credentialId
WHERE transaction_id = :transactionId;
