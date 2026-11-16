UPDATE kodama_contact_requests
SET retry_at = :retryAt
WHERE retry_at > 0 AND id = COALESCE(:id::nullable(text), id);
