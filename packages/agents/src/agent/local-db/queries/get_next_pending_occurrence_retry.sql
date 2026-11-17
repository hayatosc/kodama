SELECT retry_at AS at
FROM kodama_scheduled_occurrences
WHERE state IN ('dispatching', 'submitted')
ORDER BY retry_at ASC
LIMIT 1;
