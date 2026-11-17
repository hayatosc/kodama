SELECT COUNT(*) AS value
FROM kodama_contact_requests
WHERE state IN ('dispatching', 'submitted');
