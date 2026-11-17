INSERT INTO mcp_oauth_transactions (
  request_id,
  transaction_id,
  server_id,
  server_revision,
  state_digest,
  browser_digest,
  binding_json,
  verifier_id,
  status,
  credential_id,
  expires_at,
  created_at
)
VALUES (
  :requestId::nullable(text),
  :transactionId,
  :serverId,
  :serverRevision,
  :stateDigest,
  :browserDigest,
  :bindingJson,
  :verifierId,
  :status,
  :credentialId::nullable(text),
  :expiresAt,
  :createdAt
);
