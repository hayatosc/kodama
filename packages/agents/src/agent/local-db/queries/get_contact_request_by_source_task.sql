SELECT
  id,
  source_task AS sourceTask,
  source_entry AS sourceEntry,
  arguments,
  target_agent_id AS targetAgentId,
  request_id AS requestId,
  content,
  hop,
  state,
  submission_id AS submissionId,
  retry_at AS retryAt,
  attempts,
  result AS resultJson,
  created_at AS createdAt,
  settled_at AS settledAt,
  expires_at AS expiresAt
FROM kodama_contact_requests
WHERE source_task = :sourceTask;
