UPDATE mcp_oauth_transactions
SET
  status = :status,
  credential_id = :credentialId::nullable(text)
WHERE transaction_id = :transactionId;
