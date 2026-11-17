SELECT
  c.credential_id AS credentialId,
  c.kind,
  c.purpose,
  c.provider,
  c.status,
  c.mcp_auth_state AS mcpAuthState,
  c.revision,
  c.ciphertext,
  c.iv,
  c.wrapped_dek AS wrappedDek,
  c.wrap_iv AS wrapIv,
  c.fingerprint,
  c.last4,
  c.lease_id AS leaseId,
  c.lease_expires_at AS leaseExpiresAt,
  c.created_at AS createdAt,
  c.revoked_at AS revokedAt,
  c.last_used_at AS lastUsedAt,
  c.expires_at AS expiresAt,
  c.last_refreshed_at AS lastRefreshedAt,
  c.refresh_failures AS refreshFailures,
  c.last_refresh_failure_at AS lastRefreshFailureAt,
  c.last_refresh_failure_category AS lastRefreshFailureCategory
FROM credentials c
INNER JOIN credential_grants g
  ON g.credential_id = c.credential_id
  AND g.agent_id = :agentId
WHERE c.credential_id = :credentialId
  AND c.provider = :provider;
