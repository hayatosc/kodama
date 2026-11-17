SELECT
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
  decided_at AS decidedAt
FROM kodama_deferred_calls
ORDER BY created_at DESC
LIMIT :limit;
