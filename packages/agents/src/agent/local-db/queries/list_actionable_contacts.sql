WITH input AS (
  SELECT :now::nullable(int) AS now_at
)
SELECT
  c.id,
  c.source_task AS sourceTask,
  c.source_entry AS sourceEntry,
  c.arguments,
  c.target_agent_id AS targetAgentId,
  c.request_id AS requestId,
  c.content,
  c.hop,
  c.state,
  c.submission_id AS submissionId,
  c.retry_at AS retryAt,
  c.attempts,
  c.result AS resultJson,
  c.created_at AS createdAt,
  c.settled_at AS settledAt,
  c.expires_at AS expiresAt
FROM kodama_contact_requests AS c
CROSS JOIN input
WHERE (c.state IN ('dispatching', 'submitted') OR c.retry_at > 0)
  AND (input.now_at IS NULL OR c.retry_at <= input.now_at)
ORDER BY c.retry_at ASC, c.id ASC
LIMIT 100;
