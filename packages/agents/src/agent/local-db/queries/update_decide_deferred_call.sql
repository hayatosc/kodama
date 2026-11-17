UPDATE kodama_deferred_calls
SET state = :state, operator_note = :operatorNote, decided_at = :decidedAt
WHERE approval_id = :approvalId AND state = 'pending'
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
