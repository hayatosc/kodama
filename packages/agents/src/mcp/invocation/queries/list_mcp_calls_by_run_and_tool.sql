SELECT
  call_id AS callId,
  run_id AS runId,
  tool_id AS toolId,
  state,
  failure,
  created_at AS createdAt,
  completed_at AS completedAt
FROM kodama_mcp_calls
WHERE run_id = :runId AND tool_id = :toolId;
