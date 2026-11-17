SELECT seq, summary, created_at AS createdAt
FROM kodama_notifications
WHERE source = 'outbox' AND delivery_state = 'dispatched'
ORDER BY seq DESC
LIMIT :limit;
