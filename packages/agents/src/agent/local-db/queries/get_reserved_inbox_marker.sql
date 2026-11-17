SELECT batch_request_id AS batchRequestId
FROM kodama_event_inbox
WHERE state = 'queued' AND batch_request_id IS NOT NULL
ORDER BY created_at ASC, id ASC
LIMIT 1;
