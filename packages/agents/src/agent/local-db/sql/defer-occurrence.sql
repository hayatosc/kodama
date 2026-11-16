UPDATE kodama_scheduled_occurrences
SET retry_at = :retryAt
WHERE id = :id AND state = 'dispatching';
