UPDATE kodama_deferred_calls
SET state = 'expired', decided_at = :decidedAt
WHERE state = 'pending' AND expires_at <= :expiresBefore
RETURNING approval_id AS approvalId;
