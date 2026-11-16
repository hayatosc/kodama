UPDATE credentials
SET
  ciphertext = :ciphertext,
  wrapped_dek = :wrappedDek,
  last_used_at = :lastUsedAt,
  last_refreshed_at = :lastRefreshedAt,
  refresh_failures = :refreshFailures,
  last_refresh_failure_at = :lastRefreshFailureAt,
  last_refresh_failure_category = :lastRefreshFailureCategory
WHERE credential_id = :credentialId;
