INSERT INTO kodama_deferred_calls (
  approval_id, tool_name, tool_digest, arguments_json, reason, source_task, state, created_at, expires_at
) VALUES (
  :approvalId, :toolName, :toolDigest, :argumentsJson, :reason, :sourceTask, 'pending', :createdAt, :expiresAt
)
RETURNING
  approval_id AS approvalId,
  tool_name AS toolName,
  tool_digest AS toolDigest,
  arguments_json AS argumentsJson,
  reason,
  source_task AS sourceTask,
  state,
  operator_note AS operatorNote,
  created_at AS createdAt,
  expires_at AS expiresAt,
  decided_at AS decidedAt;
