UPDATE kodama_deferred_calls
SET state = 'expired', decided_at = :decidedAt
WHERE approval_id IN (SELECT CAST(value AS TEXT) FROM json_each(:idsJson::text))
  AND state IN ('pending', 'approved')
RETURNING approval_id AS approvalId;
