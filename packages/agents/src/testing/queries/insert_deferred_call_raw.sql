INSERT INTO kodama_deferred_calls (
  approval_id,
  tool_name,
  tool_digest,
  arguments_json,
  reason,
  source_task,
  state,
  created_at,
  expires_at,
  decided_at
) VALUES (
  :approvalId,
  :toolName,
  :toolDigest::nullable(text),
  :argumentsJson,
  :reason,
  :sourceTask,
  :state,
  :createdAt,
  :expiresAt,
  :decidedAt::nullable(int)
);
