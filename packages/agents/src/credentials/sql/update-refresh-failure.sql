UPDATE credentials
SET status = CASE WHEN :needsReauth = 1 THEN 'needs_reauth' ELSE status END,
    refresh_failures = refresh_failures + 1,
    last_refresh_failure_at = :at,
    last_refresh_failure_category = :category
WHERE credential_id = :credentialId
  AND lease_id = :leaseId
  AND revision = :revision
  AND status = 'active'
  AND lease_expires_at > :atBound;
