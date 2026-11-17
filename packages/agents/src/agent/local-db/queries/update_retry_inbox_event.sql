UPDATE kodama_event_inbox
SET batch_request_id = NULL, attempts = :attempts, next_retry_at = :nextRetryAt
WHERE id = :id;
