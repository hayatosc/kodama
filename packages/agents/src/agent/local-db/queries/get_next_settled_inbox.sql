SELECT settled_at AS at
FROM kodama_event_inbox
WHERE state IN ('admitted', 'settled', 'failed')
ORDER BY settled_at ASC
LIMIT 1;
