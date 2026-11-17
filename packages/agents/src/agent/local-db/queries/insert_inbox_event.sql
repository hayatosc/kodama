INSERT INTO kodama_event_inbox (
  id, request_id, source, session_mode, when_busy, payload_json, state, attempts, next_retry_at, created_at
) VALUES (
  :id, :requestId, :source, :sessionMode, :whenBusy, :payloadJson, 'queued', 0, :nextRetryAt, :createdAt
)
RETURNING
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
  settled_at AS settledAt;
