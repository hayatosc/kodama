SELECT next_retry_at AS at
FROM kodama_event_inbox
WHERE state = 'queued'
ORDER BY next_retry_at ASC
LIMIT 1;
