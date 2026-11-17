UPDATE kodama_contact_requests
SET result = NULL
WHERE expires_at <= :now AND retry_at = 0;
