UPDATE kodama_contact_requests
SET retry_at = 0
WHERE id = :id AND settled_at > 0;
