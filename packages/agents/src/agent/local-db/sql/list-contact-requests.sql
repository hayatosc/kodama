WITH input AS (
  SELECT :cursor::nullable(text) AS cursor_id
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
WHERE input.cursor_id IS NULL OR c.id > input.cursor_id
ORDER BY c.id ASC
LIMIT :limit;
