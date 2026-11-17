UPDATE kodama_scheduled_occurrences
SET state = 'dispatching', submission_id = NULL, settled_at = NULL, outcome = NULL, retry_at = :retryAt;
