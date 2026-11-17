UPDATE kodama_contact_requests
SET
  state = :state,
  result = :resultJson,
  settled_at = :settledAt,
  expires_at = :expiresAt,
  retry_at = :retryAt
WHERE id = :id;
