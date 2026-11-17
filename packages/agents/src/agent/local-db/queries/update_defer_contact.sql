UPDATE kodama_contact_requests
SET retry_at = :retryAt
WHERE id = :id AND (state IN ('dispatching', 'submitted') OR retry_at > 0);
