INSERT INTO audit_log (seq, op_id, at, source, action, target_kind, target_id, detail_json)
SELECT
  NULL,
  :opId::text,
  :at::int,
  'system',
  :action::text,
  'system',
  credential_id,
  :detailJson::text
FROM credentials
WHERE credential_id = :credentialId
  AND lease_id = :leaseId
  AND revision = :revision
  AND status = 'active'
  AND lease_expires_at > :atBound;
