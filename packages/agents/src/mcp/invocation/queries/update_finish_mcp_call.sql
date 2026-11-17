UPDATE kodama_mcp_calls
SET state = :state, failure = :failure, completed_at = :completedAt
WHERE call_id = :callId;
