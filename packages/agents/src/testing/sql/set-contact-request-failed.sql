UPDATE kodama_contact_requests
SET state = 'failed', settled_at = :settledAt
WHERE id = :id;
