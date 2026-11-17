SELECT
  id,
  request_id AS requestId,
  source,
  session_mode AS sessionMode,
  when_busy AS whenBusy,
  payload_json AS payloadJson,
  state,
  batch_request_id AS batchRequestId,
  submission_id AS submissionId,
  attempts,
  next_retry_at AS nextRetryAt,
  created_at AS createdAt,
  settled_at AS settledAt
FROM kodama_event_inbox
WHERE state = 'queued' AND batch_request_id = :batchRequestId
ORDER BY created_at ASC, id ASC;
