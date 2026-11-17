UPDATE kodama_scheduled_occurrences
SET attempts = :attempts, retry_at = :retryAt
WHERE id = :id AND state IN ('dispatching', 'submitted');
