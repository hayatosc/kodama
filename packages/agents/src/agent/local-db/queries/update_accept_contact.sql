UPDATE kodama_contact_requests
SET state = 'submitted', submission_id = :submissionId, retry_at = :retryAt
WHERE id = :id AND state IN ('dispatching', 'submitted');
