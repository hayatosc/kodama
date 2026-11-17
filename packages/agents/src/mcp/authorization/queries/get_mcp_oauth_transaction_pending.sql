SELECT
  request_id AS requestId,
  transaction_id AS transactionId,
  server_id AS serverId,
  server_revision AS serverRevision,
  state_digest AS stateDigest,
  browser_digest AS browserDigest,
  binding_json AS bindingJson,
  verifier_id AS verifierId,
  status,
  credential_id AS credentialId,
  expires_at AS expiresAt,
  created_at AS createdAt
FROM mcp_oauth_transactions
WHERE state_digest = :stateDigest
  AND browser_digest = :browserDigest
  AND status = 'pending'
  AND expires_at > :now
LIMIT 1;
