SELECT deliver_after AS at
FROM kodama_notifications
WHERE source = 'outbox' AND delivery_state = 'pending'
ORDER BY deliver_after ASC
LIMIT 1;
