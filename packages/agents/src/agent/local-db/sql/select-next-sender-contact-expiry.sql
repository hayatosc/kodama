SELECT expires_at AS at
FROM kodama_contact_requests
WHERE expires_at > :now AND retry_at = 0
ORDER BY expires_at ASC
LIMIT 1;
