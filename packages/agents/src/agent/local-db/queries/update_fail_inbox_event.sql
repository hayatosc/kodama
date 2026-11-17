UPDATE kodama_event_inbox
SET state = 'failed', batch_request_id = NULL, attempts = :attempts, settled_at = :settledAt
WHERE id = :id;
