UPDATE kodama_scheduled_occurrences
SET state = 'submitted', submission_id = :submissionId, retry_at = :retryAt
WHERE id = :id AND state IN ('dispatching', 'submitted');
