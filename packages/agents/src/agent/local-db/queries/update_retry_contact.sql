UPDATE kodama_contact_requests
SET attempts = :attempts, retry_at = :retryAt
WHERE id = :id;
