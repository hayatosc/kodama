SELECT
  transaction_id AS transactionId,
  verifier_id AS verifierId
FROM mcp_oauth_transactions
WHERE status IN ('pending', 'exchanging')
  AND expires_at < :now
LIMIT 100;
