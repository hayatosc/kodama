SELECT
  MIN(expires_at) AS expiresAt,
  MIN(created_at) AS createdAt
FROM kodama_artifacts
WHERE state = :state;
